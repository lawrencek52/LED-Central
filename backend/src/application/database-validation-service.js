import { defaultEffects } from "../domain/effects/default-effects.js";
import { isRendererSupported } from "./effect-render-service.js";

const PARAMETER_TYPES = new Set([
  "color",
  "number",
  "boolean",
  "palette",
  "string",
  "array",
]);

// Validates the persisted database against what the running code supports,
// repairing anything that would otherwise crash startup (invalid startup
// playback intents). Everything else is reported so an operator can fix it.
export function validateDatabase({
  effectService,
  canvasService,
  controllerService,
  playbackRepository,
}) {
  const report = {
    effects: { checked: 0, issues: [] },
    canvases: { checked: 0, issues: [] },
    controllers: { checked: 0, issues: [] },
    startupEffects: { checked: 0, issues: [], removed: [] },
  };

  const effects = effectService.list();
  const effectsById = new Map(effects.map((effect) => [effect.id, effect]));
  const defaultsById = new Map(
    defaultEffects.map((effect) => [effect.id, effect]),
  );

  report.effects.checked = effects.length;
  for (const effect of effects) {
    const issues = validateEffectDefinition(effect, defaultsById.get(effect.id));
    if (issues.length > 0) {
      report.effects.issues.push({ effectId: effect.id, issues });
    }
  }

  const controllers = controllerService.list();
  const controllersById = new Map(
    controllers.map((controller) => [controller.id, controller]),
  );
  report.controllers.checked = controllers.length;
  for (const controller of controllers) {
    const issues = validateController(controller);
    if (issues.length > 0) {
      report.controllers.issues.push({ controllerId: controller.id, issues });
    }
  }

  const canvases = canvasService.list();
  report.canvases.checked = canvases.length;
  const stripOwners = new Map();
  for (const canvas of canvases) {
    const issues = validateCanvas(canvas, controllersById);
    for (const mapping of canvas.mappings ?? []) {
      const key = `${mapping.controllerId}:${mapping.stripIndex}`;
      const owner = stripOwners.get(key);
      if (owner && owner !== canvas.id) {
        issues.push(
          `Strip ${key} is assigned to both canvas "${owner}" and "${canvas.id}"`,
        );
      } else {
        stripOwners.set(key, canvas.id);
      }
    }
    if (issues.length > 0) {
      report.canvases.issues.push({ canvasId: canvas.id, issues });
    }
  }

  const canvasesById = new Map(canvases.map((canvas) => [canvas.id, canvas]));
  const intents = playbackRepository?.list() ?? [];
  report.startupEffects.checked = intents.length;
  for (const intent of intents) {
    const issues = validateStartupIntent(intent, canvasesById, effectsById);
    if (issues.length > 0) {
      report.startupEffects.issues.push({ canvasId: intent.canvasId, issues });
      playbackRepository.remove(intent.canvasId);
      report.startupEffects.removed.push(intent.canvasId);
    }
  }

  return report;
}

function validateEffectDefinition(effect, canonical) {
  const issues = [];
  if (!isRendererSupported(effect.renderer)) {
    issues.push(
      `Unknown renderer "${effect.renderer}" has no matching implementation in code`,
    );
  }
  for (const [key, schema] of Object.entries(effect.parameters ?? {})) {
    issues.push(...validateParameterSchema(key, schema));
  }
  if (canonical) {
    for (const [key, schema] of Object.entries(canonical.parameters ?? {})) {
      const actual = effect.parameters?.[key];
      if (!actual) {
        issues.push(`Missing built-in parameter "${key}" expected by code`);
      } else if (actual.type !== schema.type) {
        issues.push(
          `Parameter "${key}" type mismatch: database has "${actual.type}", code expects "${schema.type}"`,
        );
      }
    }
  }
  return issues;
}

function validateParameterSchema(key, schema) {
  const issues = [];
  if (!schema || !PARAMETER_TYPES.has(schema.type)) {
    issues.push(`Parameter "${key}" has unknown type "${schema?.type}"`);
    return issues;
  }
  if (schema.type === "number") {
    if (
      schema.min !== undefined &&
      schema.max !== undefined &&
      schema.min > schema.max
    ) {
      issues.push(
        `Parameter "${key}" has min (${schema.min}) greater than max (${schema.max})`,
      );
    }
    if (schema.default !== undefined) {
      if (schema.min !== undefined && schema.default < schema.min) {
        issues.push(
          `Parameter "${key}" default (${schema.default}) is below min (${schema.min})`,
        );
      }
      if (schema.max !== undefined && schema.default > schema.max) {
        issues.push(
          `Parameter "${key}" default (${schema.default}) is above max (${schema.max})`,
        );
      }
    }
  }
  return issues;
}

function validateController(controller) {
  const issues = [];
  if (!controller.host) issues.push("Missing host");
  if (!Number.isInteger(controller.port) || controller.port <= 0) {
    issues.push(`Invalid port ${controller.port}`);
  }
  if (!Number.isInteger(controller.strips) || controller.strips <= 0) {
    issues.push(`Invalid strip count ${controller.strips}`);
  }
  if (
    !Array.isArray(controller.ledCounts) ||
    controller.ledCounts.length !== controller.strips
  ) {
    issues.push("ledCounts length does not match strip count");
  }
  return issues;
}

function validateCanvas(canvas, controllersById) {
  const issues = [];
  if (!Number.isInteger(canvas.width) || canvas.width <= 0) {
    issues.push(`Invalid width ${canvas.width}`);
  }
  if (!Number.isInteger(canvas.height) || canvas.height <= 0) {
    issues.push(`Invalid height ${canvas.height}`);
  }
  for (const mapping of canvas.mappings ?? []) {
    const controller = controllersById.get(mapping.controllerId);
    if (!controller) {
      issues.push(`References unknown controller ${mapping.controllerId}`);
      continue;
    }
    if (mapping.stripIndex < 0 || mapping.stripIndex >= controller.strips) {
      issues.push(
        `Strip index ${mapping.stripIndex} out of range for controller "${controller.name}" (0-${controller.strips - 1})`,
      );
    }
  }
  return issues;
}

function validateStartupIntent(intent, canvasesById, effectsById) {
  const issues = [];
  const canvas = canvasesById.get(intent.canvasId);
  const effect = effectsById.get(intent.effectId);
  if (!canvas) {
    issues.push(`References unknown canvas ${intent.canvasId}`);
  }
  if (!effect) {
    issues.push(`References unknown effect ${intent.effectId}`);
    return issues;
  }
  for (const [key, value] of Object.entries(intent.parameters ?? {})) {
    const schema = effect.parameters?.[key];
    if (!schema) continue;
    const issue = validateParameterValue(key, value, schema);
    if (issue) issues.push(issue);
  }
  if (
    !Number.isInteger(intent.fps) ||
    intent.fps < 1 ||
    intent.fps > 60
  ) {
    issues.push(`Invalid frame rate ${intent.fps}`);
  }
  return issues;
}

function validateParameterValue(key, value, schema) {
  switch (schema.type) {
    case "number":
      if (typeof value !== "number" || Number.isNaN(value)) {
        return `Parameter "${key}" should be a number`;
      }
      if (schema.min !== undefined && value < schema.min) {
        return `Parameter "${key}" value ${value} below min ${schema.min}`;
      }
      if (schema.max !== undefined && value > schema.max) {
        return `Parameter "${key}" value ${value} above max ${schema.max}`;
      }
      return null;
    case "boolean":
      return typeof value === "boolean"
        ? null
        : `Parameter "${key}" should be a boolean`;
    case "color":
      return typeof value === "string"
        ? null
        : `Parameter "${key}" should be a color string`;
    case "string":
      return typeof value === "string"
        ? null
        : `Parameter "${key}" should be a string`;
    case "array":
      return Array.isArray(value)
        ? null
        : `Parameter "${key}" should be an array`;
    case "palette":
      return value && Array.isArray(value.colors)
        ? null
        : `Parameter "${key}" should be a palette object`;
    default:
      return null;
  }
}

export function formatValidationReport(report) {
  const lines = [
    `Database validation: ${report.effects.checked} effects, ${report.canvases.checked} canvases, ` +
      `${report.controllers.checked} controllers, ${report.startupEffects.checked} startup effects checked.`,
  ];

  for (const [section, label, idKey] of [
    ["effects", "Effect", "effectId"],
    ["canvases", "Canvas", "canvasId"],
    ["controllers", "Controller", "controllerId"],
    ["startupEffects", "Startup effect", "canvasId"],
  ]) {
    for (const entry of report[section].issues) {
      lines.push(`  [${label}] ${entry[idKey]}: ${entry.issues.join("; ")}`);
    }
  }

  if (report.startupEffects.removed.length > 0) {
    lines.push(
      `  Removed ${report.startupEffects.removed.length} invalid startup effect intent(s): ${report.startupEffects.removed.join(", ")}`,
    );
  }

  return lines.join("\n");
}
