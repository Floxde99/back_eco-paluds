const axios = require('axios');

const BASE_URL = 'http://localhost:3069';

async function testLogin() {
  try {
    console.log('🔑 Test de connexion...');
    const response = await axios.post(`${BASE_URL}/login`, {
      email: 'test@example.com', // Remplacez par un email valide de votre DB
      password: 'test123' // Remplacez par le mot de passe correct
    });

    console.log('✅ Connexion réussie !');
    console.log('Token reçu:', response.data.accessToken ? 'Oui' : 'Non');
    console.log('User info:', response.data.user);

    return response.data.accessToken;
  } catch (error) {
    console.log('❌ Échec de la connexion:', error.response?.data?.error || error.message);
    if (error.response?.status === 404) {
      console.log('💡 Route /login non trouvée - vérifiez les routes');
    }
    return null;
  }
}

async function testRoutes() {
  try {
    console.log('\n🧪 Test des routes disponibles...');

    // Test route login (sans auth)
    const loginResponse = await axios.post(`${BASE_URL}/login`, {
      email: 'test@example.com',
      password: 'test123'
    }).catch(err => err.response);

    console.log('Route /login:', loginResponse?.status === 200 ? '✅ OK' : '❌ KO');

    // Test route addUser (sans auth)
    const registerResponse = await axios.post(`${BASE_URL}/addUser`, {
      firstName: 'Test',
      lastName: 'User',
      email: 'test@example.com',
      password: 'test123',
      confirmPassword: 'test123'
    }).catch(err => err.response);

    console.log('Route /addUser:', registerResponse?.status === 201 ? '✅ OK' : '❌ KO');

  } catch (error) {
    console.log('❌ Erreur lors du test des routes:', error.message);
  }
}

async function main() {
  console.log('🧪 Test du backend après corrections');
  console.log('=====================================');

  await testRoutes();
  await testLogin();

  console.log('\n✅ Tests terminés !');
}

main().catch(console.error);
