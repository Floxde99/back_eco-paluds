const axios = require('axios');

const BASE_URL = 'http://localhost:3069';

// Simuler un token d'authentification (remplacez par un vrai token)
let authToken = '';

async function testLogin() {
  try {
    console.log('🔑 Test de connexion...');
    const response = await axios.post(`${BASE_URL}/login`, {
      email: 'test@example.com', // Remplacez par un email valide
      password: 'test123'
    });
    
    authToken = response.data.accessToken;
    console.log('✅ Connexion réussie');
    return true;
  } catch (error) {
    console.log('❌ Échec de la connexion:', error.response?.data?.error || error.message);
    return false;
  }
}

async function testGetProfile() {
  try {
    console.log('\n👤 Test récupération profil...');
    const response = await axios.get(`${BASE_URL}/user/profile`, {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    
    console.log('✅ Profil récupéré:', response.data.user);
    return response.data.user;
  } catch (error) {
    console.log('❌ Échec récupération profil:', error.response?.data?.error || error.message);
    return null;
  }
}

async function testUpdateProfile() {
  try {
    console.log('\n✏️ Test mise à jour profil...');
    const response = await axios.put(`${BASE_URL}/user/profile`, {
      phone: '+33123456789',
      avatar_url: 'https://example.com/avatar.jpg'
    }, {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    
    console.log('✅ Profil mis à jour:', response.data.user);
    return true;
  } catch (error) {
    console.log('❌ Échec mise à jour profil:', error.response?.data?.error || error.message);
    return false;
  }
}

async function testGetCompletion() {
  try {
    console.log('\n📊 Test complétion profil...');
    const response = await axios.get(`${BASE_URL}/user/completion`, {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    
    console.log('✅ Complétion calculée:', response.data.completion);
    return true;
  } catch (error) {
    console.log('❌ Échec calcul complétion:', error.response?.data?.error || error.message);
    return false;
  }
}

async function testGetCompanies() {
  try {
    console.log('\n🏢 Test récupération entreprises...');
    const response = await axios.get(`${BASE_URL}/user/companies`, {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    
    console.log('✅ Entreprises récupérées:', response.data.total, 'entreprises');
    return true;
  } catch (error) {
    console.log('❌ Échec récupération entreprises:', error.response?.data?.error || error.message);
    return false;
  }
}

async function testGetStats() {
  try {
    console.log('\n📈 Test statistiques dashboard...');
    const response = await axios.get(`${BASE_URL}/dashboard/stats`, {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    
    console.log('✅ Statistiques récupérées:', response.data.userStats);
    return true;
  } catch (error) {
    console.log('❌ Échec récupération stats:', error.response?.data?.error || error.message);
    return false;
  }
}

async function runTests() {
  console.log('🧪 Tests des nouvelles fonctions API');
  console.log('=====================================');
  
  const isLoggedIn = await testLogin();
  if (!isLoggedIn) {
    console.log('\n❌ Impossible de continuer sans connexion');
    return;
  }
  
  await testGetProfile();
  await testUpdateProfile();
  await testGetCompletion();
  await testGetCompanies();
  await testGetStats();
  
  console.log('\n✅ Tests terminés !');
}

runTests().catch(console.error);
