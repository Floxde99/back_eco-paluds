const fs = require('fs');
const path = require('path');
//est-ce utile ?

// Script pour synchroniser les modèles séparés avec le schema principal
function syncPrismaModels() {
    const modelsDir = path.join(__dirname, '..', 'prisma', 'models-source');
    const schemaFile = path.join(__dirname, '..', 'prisma', 'schema.prisma');
    
    // Lire le header du schema
    const schemaHeader = `// This is your Prisma schema file,
// learn more about it in the docs: https://pris.ly/d/prisma-schema

// Looking for ways to speed up your queries, or scale easily with your serverless or edge functions?
// Try Prisma Accelerate: https://pris.ly/cli/accelerate-init

generator client {
  provider = "prisma-client-js"
  output   = "../generated/prisma"
}

datasource db {
  provider = "mysql"
  url      = env("DATABASE_URL")
}

// Models synchronisés depuis le dossier models-source/
`;

    let modelsContent = '';
    let modelFiles = [];
    
    // Lire tous les fichiers de modèles
    if (fs.existsSync(modelsDir)) {
        modelFiles = fs.readdirSync(modelsDir).filter(file => file.endsWith('.prisma'));
        console.log(`📂 Dossier trouvé: ${modelsDir}`);
        console.log(`📄 Fichiers trouvés: ${modelFiles.join(', ')}`);
        
        modelFiles.forEach(file => {
            const filePath = path.join(modelsDir, file);
            const content = fs.readFileSync(filePath, 'utf8');
            console.log(`📖 Lecture de ${file}: ${content.length} caractères`);
            modelsContent += `\n${content}\n`;
        });
    } else {
        console.log(`❌ Dossier non trouvé: ${modelsDir}`);
    }
    
    // Écrire le nouveau schema
    const fullSchema = schemaHeader + modelsContent;
    fs.writeFileSync(schemaFile, fullSchema);
    
    console.log('✅ Modèles synchronisés avec succès!');
    console.log(`📁 ${modelFiles.length} fichiers de modèles traités`);
}

// Exécuter si appelé directement
if (require.main === module) {
    syncPrismaModels();
}

module.exports = { syncPrismaModels };
