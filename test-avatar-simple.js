const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:3069';

async function testAvatarUpload() {
  try {
    console.log('🔑 Test de connexion...');
    const loginResponse = await axios.post(`${BASE_URL}/login`, {
      email: 'test@example.com',
      password: 'test123'
    });

    const authToken = loginResponse.data.accessToken;
    console.log('✅ Connexion réussie');

    console.log('\n📸 Test upload avatar...');

    // Créer un fichier image de test
    const testImagePath = path.join(__dirname, 'test-avatar.png');
    const testImageBuffer = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

    fs.writeFileSync(testImagePath, testImageBuffer);

    // Upload du fichier
    const formData = new FormData();
    formData.append('avatar', fs.createReadStream(testImagePath), {
      filename: 'test-avatar.png',
      contentType: 'image/png'
    });

    const response = await axios.post(`${BASE_URL}/user/avatar`, formData, {
      headers: {
        ...formData.getHeaders(),
        'Authorization': `Bearer ${authToken}`
      }
    });

    console.log('✅ Avatar uploadé:', response.data.user.avatar_url);

    // Nettoyer le fichier de test
    fs.unlinkSync(testImagePath);

    return response.data.user.avatar_url;
  } catch (error) {
    console.log('❌ Échec:', error.response?.data?.error || error.message);
    return null;
  }
}

testAvatarUpload().then(() => {
  console.log('\n✅ Test terminé !');
}).catch(console.error);
