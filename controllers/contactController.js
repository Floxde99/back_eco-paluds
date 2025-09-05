// Minimal contact controller
exports.postContact = (req, res) => {
  const { name, email, message } = req.body || {};
  if (!name || !email || !message) {
    return res.status(400).json({ error: 'Champs manquants' });
  }

  // TODO: forward to mailer service or save to DB
  // For now, acknowledge receipt
  res.status(200).json({ status: 'ok', received: { name, email, message } });
};
