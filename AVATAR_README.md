# Système d'Upload d'Avatar

## Description
Le système d'upload d'avatar utilise maintenant **multer** pour gérer les fichiers image au lieu de recevoir des URLs.

## Fonctionnalités
- ✅ Upload de fichiers image (PNG, JPG, JPEG, GIF, WebP)
- ✅ Validation du type de fichier
- ✅ Limitation de taille (5MB maximum)
- ✅ Noms de fichiers uniques pour éviter les conflits
- ✅ Stockage local dans `public/avatars/`
- ✅ URL accessible via `/avatars/filename`

## Route API
```
POST /user/avatar
```

### Headers requis :
```
Authorization: Bearer <token>
Content-Type: multipart/form-data
```

### Body (FormData) :
```
avatar: <fichier image>
```

## Exemple d'utilisation (JavaScript)

```javascript
const formData = new FormData();
formData.append('avatar', fileInput.files[0]);

const response = await fetch('/user/avatar', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`
  },
  body: formData
});

const result = await response.json();
console.log(result.user.avatar_url); // "/avatars/avatar-123-1234567890.png"
```

## Structure des fichiers
```
public/
  avatars/
    avatar-{userId}-{timestamp}.{ext}
```

## Sécurité
- ✅ Validation du type MIME
- ✅ Limitation de taille de fichier
- ✅ Noms de fichiers sécurisés
- ✅ Authentification requise

## Test
Utilisez le script `test-avatar-upload.js` pour tester le système :
```bash
node test-avatar-upload.js
```
