const prisma = require('../services/prisma')

async function addAdminRole() {
    try {
        console.log('🔧 Starting admin role assignment...')

        // 1. Find or create the admin role
        let adminRole = await prisma.role.findFirst({
            where: { name: 'admin' }
        })

        if (!adminRole) {
            console.log('📝 Creating admin role...')
            adminRole = await prisma.role.create({
                data: { name: 'admin' }
            })
            console.log('✅ Admin role created with ID:', adminRole.id_role)
        } else {
            console.log('✅ Admin role found with ID:', adminRole.id_role)
        }

        // 2. Find the user by email
        const userEmail = 'florian.fchr99@gmail.com'
        console.log(`\n🔍 Looking for user: ${userEmail}`)

        const user = await prisma.user.findUnique({
            where: { email: userEmail },
            include: { roleObj: true }
        })

        if (!user) {
            console.error(`❌ User not found with email: ${userEmail}`)
            process.exit(1)
        }

        console.log(`✅ User found: ${user.first_name} ${user.last_name} (ID: ${user.id_user})`)

        // 3. Check if user already has admin role
        if (user.roleId === adminRole.id_role) {
            console.log('✅ User already has admin role!')
            console.log('\n📊 Current user details:')
            console.log(`   - Name: ${user.first_name} ${user.last_name}`)
            console.log(`   - Email: ${user.email}`)
            console.log(`   - Role: ${user.roleObj?.name || 'None'}`)
            return
        }

        // 4. Update user with admin role
        console.log(`\n🔄 Updating user role to admin...`)
        const updatedUser = await prisma.user.update({
            where: { id_user: user.id_user },
            data: { roleId: adminRole.id_role },
            include: { roleObj: true }
        })

        console.log('✅ User role updated successfully!')
        console.log('\n📊 Updated user details:')
        console.log(`   - Name: ${updatedUser.first_name} ${updatedUser.last_name}`)
        console.log(`   - Email: ${updatedUser.email}`)
        console.log(`   - Role: ${updatedUser.roleObj?.name || 'None'}`)
        console.log(`   - Role ID: ${updatedUser.roleId}`)

    } catch (error) {
        console.error('❌ Error:', error.message)
        console.error(error)
        process.exit(1)
    } finally {
        await prisma.$disconnect()
    }
}

addAdminRole()
