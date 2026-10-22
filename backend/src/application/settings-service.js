export class SettingsError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

// trueRandom: each effect run gets a fresh seed from the OS's random source
// (on the Pi, the kernel pool fed by its hardware RNG), so no two runs look
// alike. Off ("pseudo"), every run uses the same fixed seeds and repeats
// exactly - for testing and regression comparisons.
const DEFAULTS = Object.freeze({ trueRandom: true });

const VALIDATORS = {
  trueRandom: (value) => typeof value === "boolean",
};

export class SettingsService {
  constructor({ repository } = {}) {
    this.repository = repository;
  }

  get() {
    return { ...DEFAULTS, ...(this.repository?.list() ?? {}) };
  }

  update(patch = {}) {
    for (const [key, value] of Object.entries(patch)) {
      const valid = VALIDATORS[key];
      if (!valid) throw new SettingsError(`Unknown setting: ${key}`);
      if (!valid(value)) throw new SettingsError(`Invalid value for ${key}`);
    }
    for (const [key, value] of Object.entries(patch)) {
      this.repository?.save(key, value);
    }
    return this.get();
  }
}
