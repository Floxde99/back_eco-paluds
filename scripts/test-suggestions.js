const { PrismaClient } = require('../generated/prisma/client');
const prisma = new PrismaClient();

// Importer la fonction de calcul des suggestions
const suggestionController = require('../controllers/suggestionController');

async function testSuggestions() {
  try {
    console.log('🔍 Test de l\'algorithme de suggestions...\n');
    
    // Vérifier d'abord les entreprises validées
    const validatedCompanies = await prisma.company.findMany({
      where: { 
        validation_status: { in: ['validated', 'approved', 'active'] }
      },
      include: {
        outputs: { include: { family: true } },
        inputs: { include: { family: true } }
      }
    });
    
    console.log('=== ENTREPRISES VALIDÉES ===');
    validatedCompanies.forEach(c => {
      console.log('\n📍', c.id_company + '.', c.name, '(Owner:', c.owner_id + ')');
      console.log('   Outputs:', c.outputs?.map(o => `${o.name} [${o.family?.name || 'sans famille'}]`).join(', '));
      console.log('   Inputs:', c.inputs?.map(i => `${i.name} [${i.family?.name || 'sans famille'}]`).join(', '));
    });
    
    if (validatedCompanies.length < 2) {
      console.log('\n❌ Il faut au moins 2 entreprises validées pour générer des suggestions !');
      return;
    }
    
    // Simuler une requête pour l'utilisateur 1 (votre compte)
    console.log('\n\n=== TEST DE MATCHING ===');
    console.log('Utilisateur testé: ID 1 (florian.fchr99@gmail.com)');
    
    // Votre entreprise
    const yourCompany = validatedCompanies.find(c => c.owner_id === 1);
    if (!yourCompany) {
      console.log('❌ Votre entreprise non trouvée ou non validée');
      return;
    }
    
    console.log('\nVotre entreprise:', yourCompany.name);
    console.log('Vos outputs (ce que vous produisez):');
    yourCompany.outputs.forEach(o => console.log('  -', o.name, '| Famille:', o.family?.name || 'NULL'));
    console.log('Vos inputs (ce que vous cherchez):');
    yourCompany.inputs.forEach(i => console.log('  -', i.name, '| Famille:', i.family?.name || 'NULL'));
    
    // Candidats (autres entreprises validées)
    const candidates = validatedCompanies.filter(c => c.id_company !== yourCompany.id_company);
    console.log('\n📋 Candidats potentiels:', candidates.length);
    
    candidates.forEach(candidate => {
      console.log('\n--- Analyse de', candidate.name, '---');
      
      // Forward matches: vos outputs -> leurs inputs
      console.log('Forward (vos outputs -> leurs inputs):');
      yourCompany.outputs.forEach(yourOutput => {
        candidate.inputs.forEach(theirInput => {
          const yourFamily = yourOutput.family?.name?.toLowerCase();
          const theirFamily = theirInput.family?.name?.toLowerCase();
          const yourName = yourOutput.name?.toLowerCase();
          const theirName = theirInput.name?.toLowerCase();
          
          if (yourFamily && theirFamily && yourFamily === theirFamily) {
            console.log(`  ✅ MATCH FAMILLE: "${yourOutput.name}" -> "${theirInput.name}" (${yourFamily})`);
          } else if (yourName && theirName && (yourName.includes(theirName) || theirName.includes(yourName))) {
            console.log(`  ⚡ MATCH NOM: "${yourOutput.name}" -> "${theirInput.name}"`);
          }
        });
      });
      
      // Backward matches: leurs outputs -> vos inputs
      console.log('Backward (leurs outputs -> vos inputs):');
      candidate.outputs.forEach(theirOutput => {
        yourCompany.inputs.forEach(yourInput => {
          const theirFamily = theirOutput.family?.name?.toLowerCase();
          const yourFamily = yourInput.family?.name?.toLowerCase();
          const theirName = theirOutput.name?.toLowerCase();
          const yourName = yourInput.name?.toLowerCase();
          
          if (theirFamily && yourFamily && theirFamily === yourFamily) {
            console.log(`  ✅ MATCH FAMILLE: "${theirOutput.name}" -> "${yourInput.name}" (${theirFamily})`);
          } else if (theirName && yourName && (theirName.includes(yourName) || yourName.includes(theirName))) {
            console.log(`  ⚡ MATCH NOM: "${theirOutput.name}" -> "${yourInput.name}"`);
          }
        });
      });
    });

  } catch (error) {
    console.error('❌ Erreur:', error);
  } finally {
    await prisma.$disconnect();
  }
}

testSuggestions();
