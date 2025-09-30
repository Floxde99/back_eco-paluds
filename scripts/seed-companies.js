const { PrismaClient } = require('../generated/prisma/client');
const prisma = new PrismaClient();

// Small set of realistic test companies around "Les Paluds" / Aubagne area
const companies = [
  {
    name: 'Plastiques Méditerranée',
    siret: '12345678900011',
    sector: 'Métallurgie / Plasturgie',
    address: 'Zone des Paluds, Aubagne',
    latitude: 43.2965,
    longitude: 5.5586,
    phone: '+33 4 90 00 11 22',
    email: 'contact@plastiques-mediterranee.example',
    website: 'https://plastiques-med.example',
    description: 'Transformation de plastiques recyclés - granulés et regranulation.',
    validation_status: 'validated',
    types: ['Plastiques', 'Recyclage'],
    outputs: [
      { name: 'Granulés plastiques', category: 'Plastique recyclé', is_been: false, unit_measure: 'tonne', description: 'Granulés pour extrusion', family: 'Plastique' },
      { name: 'Chutes PVC', category: 'PVC', is_been: true, unit_measure: 'kg', description: 'Déchets PVC à valoriser', family: 'PVC' }
    ],
    inputs: [
      { name: 'Résine vierge', category: 'Matière première', unit_measure: 'tonne', description: 'Résine pour mélange' }
    ]
  },
  {
    name: 'BioTech Solutions',
    siret: '22345678900012',
    sector: "Valorisation organique",
    address: 'Chemin des Paluds, Aubagne',
    latitude: 43.2968,
    longitude: 5.5600,
    phone: '+33 4 90 00 22 33',
    email: 'contact@biotech-solutions.example',
    website: 'https://biotech.example',
    description: 'Collecte et compostage des déchets organiques pour valorisation locale.',
    validation_status: 'validated',
    types: ['Organique', 'Compostage'],
    outputs: [
      { name: 'Compost maturé', category: 'Compost', is_been: false, unit_measure: 'm3', description: 'Compost pour agriculture locale', family: 'Organique' }
    ],
    inputs: [
      { name: 'Déchets verts', category: 'Organique', unit_measure: 'kg', description: 'Collecte déchets verts pour compostage' }
    ]
  },
  {
    name: 'Éco-Emballages Provence',
    siret: '32345678900013',
    sector: 'Emballage éco-responsable',
    address: 'Zone d’activités Les Paluds, Aubagne',
    latitude: 43.2959,
    longitude: 5.5595,
    phone: '+33 4 90 00 33 44',
    email: 'contact@eco-emballages.example',
    website: 'https://eco-emballages.example',
    description: 'Fabrication d\'emballages recyclés et compostables.',
    validation_status: 'validated',
    types: ['Emballage', 'Recyclage'],
    outputs: [
      { name: 'Boîtes carton recyclé', category: 'Carton', is_been: false, unit_measure: 'unité', description: 'Emballages pour expédition', family: 'Carton' }
    ],
    inputs: [
      { name: 'Carton recyclé', category: 'Carton', unit_measure: 'kg', description: 'Matière première carton recyclé' }
    ]
  },
  {
    name: 'Métal Service Aubagne',
    siret: '42345678900014',
    sector: 'Métallurgie',
    address: 'Route des Paluds, Aubagne',
    latitude: 43.2970,
    longitude: 5.5620,
    phone: '+33 4 90 00 44 55',
    email: 'contact@metal-service.example',
    website: 'https://metal-service.example',
    description: 'Recyclage et usinage métaux légers.',
    validation_status: 'validated',
    types: ['Métallurgie', 'Recyclage'],
    outputs: [
      { name: 'Copeaux aluminium', category: 'Aluminium', is_been: true, unit_measure: 'kg', description: 'Déchets d\'usinage aluminium', family: 'Aluminium' }
    ],
    inputs: [
      { name: 'Plaques aluminium', category: 'Aluminium', unit_measure: 'kg', description: 'Plaques pour usinage' }
    ]
  }
];

async function getOrCreateType(name) {
  if (!name) return null;
  const t = await prisma.type.findFirst({ where: { name } });
  if (t) return t;
  return prisma.type.create({ data: { name } });
}

async function getOrCreateFamily(name) {
  if (!name) return null;
  const f = await prisma.family.findFirst({ where: { name } });
  if (f) return f;
  return prisma.family.create({ data: { name } });
}

async function seed() {
  try {
    for (const c of companies) {
      console.log('---\nSeeding company:', c.name);

      // Ensure types exist
      const typeRecords = [];
      for (const tname of (c.types || [])) {
        const t = await getOrCreateType(tname);
        if (t) typeRecords.push(t);
      }

      // Upsert company by unique siret
      const company = await prisma.company.upsert({
        where: { siret: c.siret },
        update: {
          name: c.name,
          sector: c.sector,
          address: c.address,
          latitude: c.latitude,
          longitude: c.longitude,
          phone: c.phone,
          email: c.email,
          website: c.website,
          description: c.description,
          validation_status: c.validation_status,
          last_update: new Date()
        },
        create: {
          name: c.name,
          siret: c.siret,
          sector: c.sector,
          address: c.address,
          latitude: c.latitude || 0,
          longitude: c.longitude || 0,
          phone: c.phone,
          email: c.email,
          website: c.website,
          description: c.description,
          validation_status: c.validation_status || 'pending',
          creation_date: new Date(),
          last_update: new Date()
        }
      });

      // Link types in CompanyType join table (avoid duplicates)
      for (const t of typeRecords) {
        const existing = await prisma.companyType.findFirst({ where: { company_id: company.id_company, type_id: t.id_type } });
        if (!existing) {
          await prisma.companyType.create({ data: { company_id: company.id_company, type_id: t.id_type } });
        }
      }

      // Create families and outputs
      for (const out of (c.outputs || [])) {
        const fam = out.family ? await getOrCreateFamily(out.family) : null;

        // Check if similar output exists for the company (by name + is_been)
        const exists = await prisma.output.findFirst({ where: { company_id: company.id_company, name: out.name, is_been: out.is_been } });
        if (exists) continue;

        await prisma.output.create({
          data: {
            name: out.name,
            category: out.category,
            is_been: !!out.is_been,
            unit_measure: out.unit_measure || 'unit',
            description: out.description || null,
            status: 'active',
            company_id: company.id_company,
            family_id: fam ? fam.id_family : null
          }
        });
      }

      // Create inputs (besoins)
      for (const inp of (c.inputs || [])) {
        const fam = inp.family ? await getOrCreateFamily(inp.family) : null;
        const exists = await prisma.input.findFirst({ where: { company_id: company.id_company, name: inp.name } });
        if (exists) continue;
        await prisma.input.create({
          data: {
            name: inp.name,
            category: inp.category,
            unit_measure: inp.unit_measure || 'unit',
            description: inp.description || null,
            status: 'active',
            company_id: company.id_company,
            family_id: fam ? fam.id_family : null
          }
        });
      }

      console.log('Seeded:', company.name, 'id=', company.id_company);
    }

    console.log('\nSeeding finished successfully');
  } catch (err) {
    console.error('Seeding error:', err);
  } finally {
    await prisma.$disconnect();
  }
}

seed();
