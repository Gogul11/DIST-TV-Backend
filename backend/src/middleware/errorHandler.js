const { HttpError } = require("../utils/httpError");

function errorHandler(err, req, res, next) {
  const statusCode = err instanceof HttpError ? err.statusCode : 500;
  const message = err instanceof HttpError ? err.message : "Internal Server Error";
  const details = err instanceof HttpError ? err.details : undefined;

  if (statusCode >= 500) {
    // eslint-disable-next-line no-console
    console.error(err);
  }

  res.status(statusCode).json({ ok: false, error: { message, details } });
}

module.exports = { errorHandler };

