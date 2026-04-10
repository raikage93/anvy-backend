function errorHandler(err, req, res, _next) {
  console.error('❌ Error:', err.message);
  const status = err.status || (err.name === 'MulterError' ? 400 : 500);
  res.status(status).json({
    error: err.message || 'Internal server error',
  });
}

module.exports = { errorHandler };
