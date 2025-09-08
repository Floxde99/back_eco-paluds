// Controller for dashboard-related endpoints
const { PrismaClient } = require("../generated/prisma/client");
const prisma = new PrismaClient();

exports.getStats = async (req, res) => {
  try {
    const userId = req.user.userId;
    
    // Récupérer les statistiques globales pour l'utilisateur
    const [
      userCompanies,
      totalUsers,
      totalCompanies,
      recentInputs,
      recentOutputs,
      userSubscription
    ] = await Promise.all([
      // Entreprises de l'utilisateur
      prisma.company.findMany({
        where: { owner_id: userId },
        include: {
          inputs: { where: { status: 'active' } },
          outputs: { where: { status: 'active' } }
        }
      }),
      
      // Statistiques globales (si l'utilisateur est admin)
      prisma.user.count(),
      prisma.company.count(),
      
      // Activité récente des inputs de l'utilisateur
      prisma.input.findMany({
        where: {
          company: { owner_id: userId }
        },
        orderBy: { creation_date: 'desc' },
        take: 5,
        include: { company: { select: { name: true } } }
      }),
      
      // Activité récente des outputs de l'utilisateur
      prisma.output.findMany({
        where: {
          company: { owner_id: userId }
        },
        orderBy: { creation_date: 'desc' },
        take: 5,
        include: { company: { select: { name: true } } }
      }),
      
      // Abonnement actuel de l'utilisateur
      prisma.subscription.findFirst({
        where: { 
          user_id: userId,
          status: 'active'
        },
        orderBy: { start_date: 'desc' }
      })
    ]);

    // Calculer les statistiques utilisateur
    const userStats = {
      companiesCount: userCompanies.length,
      totalInputs: userCompanies.reduce((sum, company) => sum + company.inputs.length, 0),
      totalOutputs: userCompanies.reduce((sum, company) => sum + company.outputs.length, 0),
      companiesWithValidation: userCompanies.filter(c => c.validation_status === 'validated').length
    };

    // Calculer les flows potentiels (matching inputs/outputs)
    const allUserInputs = userCompanies.flatMap(c => c.inputs);
    const allUserOutputs = userCompanies.flatMap(c => c.outputs);
    
    const potentialFlows = await prisma.flow.count({
      where: {
        OR: [
          { input_id: { in: allUserInputs.map(i => i.id_input) } },
          { output_id: { in: allUserOutputs.map(o => o.id_output) } }
        ]
      }
    });

    return res.status(200).json({
      userStats,
      globalStats: {
        totalUsers,
        totalCompanies,
        totalFlows: potentialFlows
      },
      recentActivity: {
        inputs: recentInputs.map(input => ({
          id: input.id_input,
          name: input.name,
          company: input.company.name,
          date: input.creation_date,
          status: input.status
        })),
        outputs: recentOutputs.map(output => ({
          id: output.id_output,
          name: output.name,
          company: output.company.name,
          date: output.creation_date,
          status: output.status
        }))
      },
      subscription: userSubscription ? {
        type: userSubscription.subscription_type,
        status: userSubscription.status,
        endDate: userSubscription.end_date,
        aiConsumption: userSubscription.ai_consumption,
        billingThreshold: userSubscription.billing_threshold
      } : null
    });
  } catch (error) {
    console.error('❌ Erreur getStats:', error);
    return res.status(500).json({ error: 'Erreur interne du serveur' });
  }
};
