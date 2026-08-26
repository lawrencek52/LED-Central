export function createAuthMiddleware({ token }) {
  return (req, res, next) => {
    if (!token) return next();

    const authorization = req.get('authorization') || '';
    if (authorization === `Bearer ${token}`) return next();

    return res.status(401).json({
      error: 'Authentication required',
      requestId: req.requestId
    });
  };
}
