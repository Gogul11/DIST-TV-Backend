function notFound(req, res) {
  res.status(404).json({ ok: false, error: { message: "Not Found" } });
}

module.exports = { notFound };

