const { PrismaClient } = require('../generated/prisma/client');
const prisma = new PrismaClient();

async function debug() {
  try {
    // 1. Vérifier TOUTES les entreprises
    console.log('=== TOUTES LES ENTREPRISES ===');
    const allCompanies = await prisma.company.findMany({
      include: {
        outputs: true,
        inputs: true
      }
    });
    
    allCompanies.forEach(c => {
      console.log('\n📍', c.id_company + '.', c.name);
      console.log('   Owner ID:', c.owner_id);
      console.log('   Status:', c.validation_status);
      console.log('   SIRET:', c.siret);
      console.log('   Lat/Lng:', c.latitude, '/', c.longitude);
      console.log('   Outputs:', c.outputs?.length || 0);
      c.outputs?.forEach(o => console.log('      - Output:', o.name, '| famille_id:', o.family_id));
      console.log('   Inputs:', c.inputs?.length || 0);
      c.inputs?.forEach(i => console.log('      - Input:', i.name, '| famille_id:', i.family_id));
    });
    
    // 2. Vérifier les familles
    console.log('\n=== FAMILLES DE RESSOURCES ===');
    const families = await prisma.family.findMany();
    families.forEach(f => console.log('  ID:', f.id_family, '-', f.name));
    
    // 3. Vérifier les utilisateurs
    console.log('\n=== UTILISATEURS ===');
    const users = await prisma.user.findMany({
      select: {
        id_user: true,
        email: true,
        first_name: true,
        last_name: true,
        companies: {
          select: {
            id_company: true,
            name: true
          }
        }
      }
    });
    users.forEach(u => {
      console.log('  User ID:', u.id_user, '-', u.email);
      console.log('    Companies:', u.companies.map(c => `${c.name} (ID: ${c.id_company})`).join(', ') || 'aucune');
    });

  } catch (error) {
    console.error('❌ Erreur:', error);
  } finally {
    await prisma.$disconnect();
  }
}

debug();
