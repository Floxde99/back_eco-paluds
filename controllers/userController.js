const {PrismaClient} = require('@prisma/client');
const prisma = new PrismaClient();
const bcrypt = require('bcrypt');

exports.addUser = async (req, res) => {
    try {
        if (req.body.password === req.body.confirmPassword) {
            const hashedPassword = await bcrypt.hash(req.body.password, 10);
            const newUser = await prisma.user.create({
                data: {
                    firstName: req.body.firstName,
                    lastName: req.body.lastName,
                    email: req.body.email,
                    password: hashedPassword,
                    phone: req.body.phone,
                    role: req.body.role
                    
                },
            });
            return res.redirect('/login');
        } else {
            throw new Error("Les mots de passe ne correspondent pas");
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }}
