const { PrismaClient } = require('../generated/prisma/client');
const prisma = new PrismaClient();

// Simuler la génération de suggestions pour l'utilisateur 1
async function testSuggestionsAPI() {
  try {
    // Récupérer l'entreprise de l'utilisateur 1
    const company = await prisma.company.findFirst({
      where: { owner_id: 1 },
      include: {
        outputs: { include: { family: true } },
        inputs: { include: { family: true } }
      }
    });

    if (!company) {
      console.log('❌ Aucune entreprise pour l\'utilisateur 1');
      return;
    }

    console.log('✅ Entreprise trouvée:', company.name);

    // Récupérer les candidats
    const candidates = await prisma.company.findMany({
      where: {
        id_company: { not: company.id_company },
        validation_status: { in: ['validated', 'approved', 'active'] }
      },
      include: {
        outputs: { include: { family: true } },
        inputs: { include: { family: true } }
      }
    });

    console.log('📋 Candidats validés:', candidates.length);
    
    if (candidates.length === 0) {
      console.log('❌ Aucun candidat validé trouvé');
      return;
    }

    candidates.forEach(c => {
      console.log('\n  - ', c.name);
      console.log('     Outputs:', c.outputs.map(o => `${o.name} [${o.family?.name}]`).join(', '));
      console.log('     Inputs:', c.inputs.map(i => `${i.name} [${i.family?.name}]`).join(', '));
    });

    // Vérifier les interactions existantes
    const interactions = await prisma.suggestionInteraction.findMany({
      where: { user_id: 1 }
    });

    console.log('\n📊 Interactions existantes:', interactions.length);
    interactions.forEach(i => {
      console.log('  - Entreprise cible ID:', i.target_company_id);
      console.log('    Status:', i.status);
      console.log('    Score:', i.last_score);
    });

  } catch (error) {
    console.error('❌ Erreur:', error);
  } finally {
    await prisma.$disconnect();
  }
}

testSuggestionsAPI();
