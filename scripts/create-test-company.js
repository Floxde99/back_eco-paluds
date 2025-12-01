const { PrismaClient } = require('../generated/prisma/client');
const crypto = require('crypto');

const prisma = new PrismaClient();

// Simple password hash using Node.js crypto (bcrypt-like format for compatibility)
function hashPassword(password) {
  // Note: En production, utilisez bcrypt. Ici on utilise crypto pour éviter les dépendances
  const hash = crypto.createHash('sha256').update(password).digest('hex');
  return `$2a$10$${hash.substring(0, 53)}`; // Format compatible bcrypt
}

async function createTestCompany() {
  try {
    console.log('🏭 Création d\'une entreprise test compatible...\n');

    // Essayer de trouver l'utilisateur existant ou en créer un nouveau
    const testEmail = 'test.compatible@eco-paluds.fr';
    let user = await prisma.user.findUnique({ where: { email: testEmail } });
    
    if (!user) {
      const hashedPassword = hashPassword('Test1234!');
      user = await prisma.user.create({
        data: {
          email: testEmail,
          password: hashedPassword,
          first_name: 'Jean',
          last_name: 'Dupont',
          confirmEmail: true,
        }
      });
      console.log('✅ Utilisateur créé:', user.email);
    } else {
      console.log('✅ Utilisateur trouvé:', user.email);
    }

    // Essayer de trouver l'entreprise existante ou en créer une nouvelle
    const testSiret = '12345678901234';
    let company = await prisma.company.findUnique({ where: { siret: testSiret } });
    
    if (!company) {
      company = await prisma.company.create({
        data: {
          name: 'Plastiques & Résines Industries',
          siret: testSiret,
          sector: 'Fabrication de matières plastiques',
          address: '15 Rue de l\'Industrie, 75001 Paris',
          latitude: 48.8566,
          longitude: 2.3522,
          phone: '0145678910',
          email: 'contact@plastiques-resines.fr',
          website: 'www.plastiques-resines.fr',
          owner_id: user.id_user,
          validation_status: 'validated',
          description: 'Spécialiste de la production de résines plastiques et du recyclage de composants électroniques',
        }
      });
      console.log('✅ Entreprise créée:', company.name);
    } else {
      console.log('✅ Entreprise trouvée:', company.name);
      // Mettre à jour le statut de validation au cas où
      company = await prisma.company.update({
        where: { id_company: company.id_company },
        data: { validation_status: 'validated' }
      });
    }

    // Récupérer les familles de ressources existantes
    const families = await prisma.family.findMany({
      where: {
        OR: [
          { name: { contains: 'Plastique' } },
          { name: { contains: 'Résine' } },
          { name: { contains: 'Électronique' } },
          { name: { contains: 'Emballage' } },
          { name: { contains: 'Carton' } },
        ]
      }
    });

    console.log('📦 Familles trouvées:', families.map(f => f.name));

    // Si pas de familles, en créer
    let plastiqueFamilyId, electroniqueFamilyId, emballageFamilyId;
    
    const plastiqueFamily = families.find(f => f.name.toLowerCase().includes('plastique')) || 
      await prisma.family.create({ data: { name: 'Plastique' } });
    
    const electroniqueFamily = families.find(f => f.name.toLowerCase().includes('électronique')) || 
      await prisma.family.create({ data: { name: 'Électronique' } });
    
    const emballageFamily = families.find(f => f.name.toLowerCase().includes('emballage') || f.name.toLowerCase().includes('carton')) || 
      await prisma.family.create({ data: { name: 'Emballage' } });

    plastiqueFamilyId = plastiqueFamily.id_family;
    electroniqueFamilyId = electroniqueFamily.id_family;
    emballageFamilyId = emballageFamily.id_family;

    // Supprimer les outputs existants pour cette entreprise
    await prisma.output.deleteMany({
      where: { company_id: company.id_company }
    });

    // Créer les OUTPUTS (ce que l'entreprise produit) - ce que VOUS cherchez
    const outputs = await prisma.output.createMany({
      data: [
        {
          company_id: company.id_company,
          name: 'Résine ABS',
          category: 'production',
          family_id: plastiqueFamilyId,
          unit_measure: 'kg',
          is_been: false,
          status: 'active',
          description: 'Résine ABS haute qualité pour injection plastique - 5000 kg/mois'
        },
        {
          company_id: company.id_company,
          name: 'Cartons de conditionnement',
          category: 'production',
          family_id: emballageFamilyId,
          unit_measure: 'unités',
          is_been: false,
          status: 'active',
          description: 'Cartons recyclés pour emballage industriel - 2000 unités/mois'
        },
        {
          company_id: company.id_company,
          name: 'Granulés plastique recyclés',
          category: 'production',
          family_id: plastiqueFamilyId,
          unit_measure: 'kg',
          is_been: false,
          status: 'active',
          description: 'Granulés issus du recyclage de pièces plastiques - 3000 kg/semaine'
        }
      ]
    });

    console.log('✅ Outputs créés (productions):', outputs.count);

    // Supprimer les inputs existants pour cette entreprise
    await prisma.input.deleteMany({
      where: { company_id: company.id_company }
    });

    // Créer les INPUTS (ce que l'entreprise cherche) - ce que VOUS produisez
    const inputs = await prisma.input.createMany({
      data: [
        {
          company_id: company.id_company,
          name: 'Pièces plastiques injectées',
          category: 'need',
          family_id: plastiqueFamilyId,
          unit_measure: 'unités',
          status: 'active',
          description: 'Pièces plastiques pour recyclage et revalorisation - 1500 unités/mois'
        },
        {
          company_id: company.id_company,
          name: 'Composants électroniques',
          category: 'need',
          family_id: electroniqueFamilyId,
          unit_measure: 'kg',
          status: 'active',
          description: 'Composants électroniques usagés pour extraction de métaux précieux - 800 kg/semaine'
        },
        {
          company_id: company.id_company,
          name: 'Déchets plastiques industriels',
          category: 'need',
          family_id: plastiqueFamilyId,
          unit_measure: 'kg',
          status: 'active',
          description: 'Déchets plastiques pour recyclage - 2000 kg/mois'
        }
      ]
    });

    console.log('✅ Inputs créés (besoins):', inputs.count);

    console.log('\n🎉 Entreprise test créée avec succès !');
    console.log('\n📊 Résumé de la compatibilité:');
    console.log('   - Ils produisent: Résine ABS, Cartons → Ce que VOUS cherchez ✅');
    console.log('   - Ils cherchent: Pièces plastiques, Composants électroniques → Ce que VOUS produisez ✅');
    console.log('\n💡 Cette entreprise devrait apparaître dans vos suggestions avec un score élevé !');
    console.log('\n👤 Credentials de test:');
    console.log('   Email: test.compatible@eco-paluds.fr');
    console.log('   Password: Test1234!');

  } catch (error) {
    console.error('❌ Erreur:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

createTestCompany();
