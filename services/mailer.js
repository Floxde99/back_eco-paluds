require('dotenv').config();
const nodemailer = require('nodemailer');

console.log('🔍 Mailer starting with ENV:', {
  MAIL_HOST: process.env.MAIL_HOST,
  MAIL_PORT: process.env.MAIL_PORT
});

// Forcer les valeurs (éviter localhost)
const hostValue = process.env.MAIL_HOST || 'ssl0.ovh.net';
const portValue = parseInt(process.env.MAIL_PORT || '465', 10);

const transporter = nodemailer.createTransport({
  host: hostValue,
  port: portValue,
  secure: portValue === 465,
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS,
  },
});

// Verify transporter at startup
transporter.verify().then(() => {
  console.log('✅ Mailer transporter ready');
}).catch(err => {
  console.warn('⚠️ Mailer transporter verification failed:', err.message || err);
});

function sendMail(to, subject, text, html) {
  const mailOptions = {
    from: `"Eco-Paluds" <${process.env.MAIL_USER}>`,
    to,
    subject,
    text,
    html,
  };

  return transporter.sendMail(mailOptions).then(info => {
    console.log('✅ Email envoyé :', info && info.response);
    return info;
  }).catch(error => {
    console.error('❌ Erreur envoi email :', error);
    throw error;
  });
}

module.exports = { sendMail };
