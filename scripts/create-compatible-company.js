const { PrismaClient } = require('../generated/prisma/client');
const crypto = require('crypto');

const prisma = new PrismaClient();

function hashPassword(password) {
  const hash = crypto.createHash('sha256').update(password).digest('hex');
  return `$2a$10$${hash.substring(0, 53)}`;
}

async function createCompatibleCompany() {
  try {
    console.log('🏭 Création d\'une NOUVELLE entreprise test compatible...\n');

    // 1. Créer un nouvel utilisateur avec un email unique
    const timestamp = Date.now();
    const testEmail = `test.compatible.${timestamp}@eco-paluds.fr`;
    
    const user = await prisma.user.create({
      data: {
        email: testEmail,
        password: hashPassword('Test1234!'),
        first_name: 'Marie',
        last_name: 'Martin',
        confirmEmail: true,
      }
    });
    console.log('✅ Utilisateur créé:', user.email, '(ID:', user.id_user, ')');

    // 2. Créer une NOUVELLE entreprise avec un SIRET unique
    const testSiret = `99${timestamp}`.substring(0, 14).padEnd(14, '0');
    
    const company = await prisma.company.create({
      data: {
        name: 'Recyclage Industriel du Sud',
        siret: testSiret,
        sector: 'Recyclage et valorisation des déchets',
        address: '25 Avenue de la Recyclerie, 13001 Marseille',
        latitude: 43.2965, // Proche de votre entreprise
        longitude: 5.3698,
        phone: '0491234567',
        email: 'contact@recyclage-sud.fr',
        website: 'www.recyclage-sud.fr',
        owner_id: user.id_user,
        validation_status: 'validated', // IMPORTANT: doit être validé !
        description: 'Expert en recyclage de plastiques et composants électroniques',
      }
    });
    console.log('✅ Entreprise créée:', company.name, '(ID:', company.id_company, ')');
    console.log('   Status:', company.validation_status);
    console.log('   SIRET:', company.siret);

    // 3. Récupérer les familles existantes
    const plastiqueFamily = await prisma.family.findFirst({ where: { name: 'Plastique' } });
    const electroniqueFamily = await prisma.family.findFirst({ where: { name: 'Électronique' } });
    const emballageFamily = await prisma.family.findFirst({ where: { name: 'Emballage' } });

    console.log('\n📦 Familles utilisées:');
    console.log('   Plastique ID:', plastiqueFamily?.id_family);
    console.log('   Électronique ID:', electroniqueFamily?.id_family);
    console.log('   Emballage ID:', emballageFamily?.id_family);

    // 4. Créer les OUTPUTS - Ce que cette entreprise PRODUIT
    // = Ce que VOUS (ecopaluds) CHERCHEZ (Résine ABS, Cartons de conditionnement, etc.)
    const outputs = await prisma.output.createMany({
      data: [
        {
          company_id: company.id_company,
          name: 'Résine ABS recyclée',
          category: 'production',
          family_id: plastiqueFamily?.id_family || 1,
          unit_measure: 'kg',
          is_been: false,
          status: 'active',
          description: 'Résine ABS haute qualité issue du recyclage'
        },
        {
          company_id: company.id_company,
          name: 'Cartons de conditionnement',
          category: 'production',
          family_id: emballageFamily?.id_family || 3,
          unit_measure: 'unités',
          is_been: false,
          status: 'active',
          description: 'Cartons recyclés pour emballage industriel'
        },
        {
          company_id: company.id_company,
          name: 'Acier inoxydable récupéré',
          category: 'production',
          family_id: electroniqueFamily?.id_family || 2,
          unit_measure: 'kg',
          is_been: false,
          status: 'active',
          description: 'Acier inoxydable extrait de composants recyclés'
        }
      ]
    });
    console.log('\n✅ Outputs créés:', outputs.count);

    // 5. Créer les INPUTS - Ce que cette entreprise CHERCHE
    // = Ce que VOUS (ecopaluds) PRODUISEZ (Pièces plastiques, Composants électroniques)
    const inputs = await prisma.input.createMany({
      data: [
        {
          company_id: company.id_company,
          name: 'Pièces plastiques injectées usagées',
          category: 'need',
          family_id: plastiqueFamily?.id_family || 1,
          unit_measure: 'unités',
          status: 'active',
          description: 'Pièces plastiques pour recyclage'
        },
        {
          company_id: company.id_company,
          name: 'Composants électroniques',
          category: 'need',
          family_id: electroniqueFamily?.id_family || 2,
          unit_measure: 'kg',
          status: 'active',
          description: 'Composants électroniques pour extraction métaux'
        },
        {
          company_id: company.id_company,
          name: 'Granulés plastique',
          category: 'need',
          family_id: plastiqueFamily?.id_family || 1,
          unit_measure: 'kg',
          status: 'active',
          description: 'Granulés plastique pour transformation'
        }
      ]
    });
    console.log('✅ Inputs créés:', inputs.count);

    // 6. Vérification finale
    console.log('\n========================================');
    console.log('🎉 ENTREPRISE TEST CRÉÉE AVEC SUCCÈS !');
    console.log('========================================');
    console.log('\n📊 COMPATIBILITÉ ATTENDUE:');
    console.log('   VOTRE entreprise (ecopaluds) PRODUIT:');
    console.log('      - Résine ABS (famille Plastique)');
    console.log('      - Cartons de conditionnement (famille Emballage)');
    console.log('      - Granulés plastique recyclés (famille Plastique)');
    console.log('   VOTRE entreprise (ecopaluds) CHERCHE:');
    console.log('      - Pièces plastiques injectées (famille Plastique)');
    console.log('      - Composants électroniques (famille Électronique)');
    console.log('      - Déchets plastiques industriels (famille Plastique)');
    console.log('\n   NOUVELLE entreprise PRODUIT:');
    console.log('      - Résine ABS recyclée → Match avec votre BESOIN ✅');
    console.log('      - Cartons de conditionnement → Vous en avez besoin indirectement');
    console.log('      - Acier inoxydable récupéré → Match possible');
    console.log('   NOUVELLE entreprise CHERCHE:');
    console.log('      - Pièces plastiques → Vous en produisez (via Granulés) ✅');
    console.log('      - Composants électroniques → Match avec votre OUTPUT? ✅');
    console.log('      - Granulés plastique → Vous en produisez ✅');
    
    console.log('\n💡 Rafraîchissez la page Suggestions !');

  } catch (error) {
    console.error('❌ Erreur:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

createCompatibleCompany();
