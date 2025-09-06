const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const headerPath = path.join(root, 'prisma', 'schema.header.prisma');
const modelsDir = path.join(root, 'prisma', 'models');
const outPath = path.join(root, 'prisma', 'schema.prisma');

console.log('🔄 Synchronisation des modèles Prisma...');

// Lire le header
let header = '';
if (fs.existsSync(headerPath)) {
  header = fs.readFileSync(headerPath, 'utf8');
  console.log('✅ Header chargé depuis schema.header.prisma');
} else {
  console.warn('⚠️ Fichier header non trouvé, utilisation du header par défaut');
  header = `// This is your Prisma schema file,
// learn more about it in the docs: https://pris.ly/d/prisma-schema

generator client {
  provider = "prisma-client-js"
  output   = "../generated/prisma"
}

datasource db {
  provider = "mysql"
  url      = env("DATABASE_URL")
}`;
}

// Lire tous les modèles
const modelFiles = [];
if (fs.existsSync(modelsDir)) {
  const files = fs.readdirSync(modelsDir)
    .filter(f => f.endsWith('.prisma'))
    .sort();
  
  modelFiles.push(...files);
  console.log(`📁 ${files.length} fichiers de modèles trouvés:`, files.join(', '));
} else {
  console.warn('⚠️ Dossier prisma/models non trouvé');
}

// Concaténer tous les modèles
const models = modelFiles
  .map(f => {
    const content = fs.readFileSync(path.join(modelsDir, f), 'utf8');
    console.log(`   - ${f} chargé`);
    return content;
  })
  .join('\n\n');

// Générer le fichier final
const finalContent = header + '\n\n' + models;
fs.writeFileSync(outPath, finalContent, 'utf8');

console.log('✅ prisma/schema.prisma généré avec succès');
console.log(`📊 Statistiques: ${modelFiles.length} modèles, ${finalContent.split('\n').length} lignes`);
