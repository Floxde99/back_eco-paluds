const mailer = require('../services/mailer.js');

exports.postContact = async (req, res) => {
    try {
        console.log('📧 Données reçues pour contact:', req.body);
        
        const { name, phone, email, subject, message } = req.body;

        // Validation des champs obligatoires
        if (!email || !subject || !message) {
            console.log('❌ Champs manquants:', { email: !!email, subject: !!subject, message: !!message });
            return res.status(400).json({ 
                error: "Email, sujet et message sont obligatoires",
                missing: {
                    email: !email,
                    subject: !subject,
                    message: !message
                }
            });
        }

        // Validation du format email
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email.trim())) {
            console.log('❌ Format email invalide:', email);
            return res.status(400).json({ 
                error: "Format d'email invalide" 
            });
        }

        // Préparation des données nettoyées
        const cleanData = {
            name: name?.trim() || 'Non renseigné',
            phone: phone?.trim() || 'Non renseigné',
            email: email.trim(),
            subject: subject.trim(),
            message: message.trim()
        };

        console.log('📧 Envoi de l\'email de contact...');

        // Envoi de l'email à l'équipe EcoPaluds
        await mailer.sendMail(
            process.env.MAIL_USER, // Destinataire
            `[EcoPaluds] ${cleanData.subject} - ${cleanData.name}`, // Sujet
            `Nouveau message de contact:\n\nNom: ${cleanData.name}\nTéléphone: ${cleanData.phone}\nEmail: ${cleanData.email}\nSujet: ${cleanData.subject}\n\nMessage:\n${cleanData.message}`, // Texte brut
            `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #2c5530;">Nouveau message de contact - EcoPaluds</h2>
                <div style="background-color: #f5f5f5; padding: 20px; border-radius: 8px;">
                    <p><strong>Nom:</strong> ${cleanData.name}</p>
                    <p><strong>Téléphone:</strong> ${cleanData.phone}</p>
                    <p><strong>Email:</strong> <a href="mailto:${cleanData.email}">${cleanData.email}</a></p>
                    <p><strong>Sujet:</strong> ${cleanData.subject}</p>
                </div>
                <div style="margin-top: 20px; padding: 20px; border-left: 4px solid #2c5530;">
                    <h3>Message:</h3>
                    <p style="white-space: pre-line;">${cleanData.message}</p>
                </div>
                <div style="margin-top: 20px; font-size: 12px; color: #666;">
                    <p>Message envoyé depuis le site EcoPaluds le ${new Date().toLocaleString('fr-FR')}</p>
                </div>
            </div>
            ` // HTML
        );

        console.log('✅ Email de contact envoyé à l\'équipe');

        // Envoi de la confirmation de réception à l'expéditeur
        console.log('📧 Envoi de la confirmation de réception...');
        await mailer.sendMail(
            cleanData.email, // Destinataire : l'expéditeur du message
            `Confirmation de réception - ${cleanData.subject}`, // Sujet
            `Bonjour ${cleanData.name},

Nous avons bien reçu votre message concernant : "${cleanData.subject}".

Notre équipe vous répondra dans les plus brefs délais.

Voici un récapitulatif de votre message :
- Sujet : ${cleanData.subject}
- Message : ${cleanData.message}

Merci de nous avoir contactés !

Cordialement,
L'équipe EcoPaluds`, // Texte brut
            `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #f9f9f9; padding: 20px; border-radius: 10px;">
                <div style="text-align: center; margin-bottom: 30px;">
                    <h1 style="color: #2c5530; margin: 0;">EcoPaluds</h1>
                    <h2 style="color: #4a7c59; margin: 10px 0;">Confirmation de réception</h2>
                </div>
                
                <div style="background-color: white; padding: 25px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                    <p style="font-size: 16px; color: #333;">Bonjour <strong>${cleanData.name}</strong>,</p>
                    
                    <p style="color: #555; line-height: 1.6;">
                        Nous avons bien reçu votre message concernant : 
                        <strong style="color: #2c5530;">"${cleanData.subject}"</strong>
                    </p>
                    
                    <div style="background-color: #e8f5e8; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #2c5530;">
                        <p style="margin: 0; color: #2c5530; font-weight: bold;">📧 Votre message :</p>
                        <p style="margin: 10px 0 0 0; color: #444; white-space: pre-line; font-style: italic;">"${cleanData.message}"</p>
                    </div>
                    
                    <p style="color: #555; line-height: 1.6;">
                        Notre équipe examine votre demande et vous répondra dans les plus brefs délais.
                    </p>
                    
                    <div style="background-color: #f0f8ff; padding: 15px; border-radius: 5px; margin: 20px 0;">
                        <p style="margin: 0; color: #2c5530; font-size: 14px;">
                            💡 <strong>Temps de réponse habituel :</strong> 24-48 heures (jours ouvrés)
                        </p>
                    </div>
                </div>
                
                <div style="text-align: center; margin-top: 30px; padding: 20px; border-top: 1px solid #ddd;">
                    <p style="color: #666; margin: 0 0 10px 0;">Merci de nous avoir contactés !</p>
                    <p style="color: #2c5530; font-weight: bold; margin: 0;">L'équipe EcoPaluds</p>
                </div>
                
                <div style="margin-top: 20px; font-size: 12px; color: #999; text-align: center;">
                    <p>Message automatique envoyé le ${new Date().toLocaleString('fr-FR')}</p>
                    <p>Ceci est un email automatique, merci de ne pas y répondre directement.</p>
                </div>
            </div>
            ` // HTML
        );

        console.log('✅ Confirmation de réception envoyée');
        console.log('✅ Processus de contact terminé avec succès');
        res.status(200).json({ 
            message: "Votre message a été envoyé avec succès. Nous vous répondrons dans les plus brefs délais." 
        });

    } catch (error) {
        console.error('❌ Erreur lors de l\'envoi du message de contact:', error);
        res.status(500).json({ 
            error: "Erreur lors de l'envoi du message. Veuillez réessayer.",
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}