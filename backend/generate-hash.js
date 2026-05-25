// Corré este script UNA SOLA VEZ para generar el hash de tu contraseña
// Uso: node generate-hash.js TuContraseña
const bcrypt = require('bcryptjs');
const password = process.argv[2];
if (!password) {
  console.log('Uso: node generate-hash.js TuContraseña');
  process.exit(1);
}
bcrypt.hash(password, 10).then(hash => {
  console.log('\n✅ Copiá este hash en Railway como ADMIN_PASSWORD_HASH:');
  console.log(hash);
  console.log('');
});
