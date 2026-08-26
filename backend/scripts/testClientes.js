/**
 * Prueba de la sincronización del padrón de clientes.
 *
 *   cd backend && npm run test:clientes
 *
 * CÓMO ESTÁ HECHA
 *   Levanta una API falsa en un puerto libre que responde `/api/clientes` con
 *   el mismo formato que la de Quiter, y apunta el sistema a ella. Así se
 *   ejercita el camino completo —la llamada HTTP, el mapeo de campos, el
 *   upsert, las bajas— sin depender de que el ERP de verdad esté disponible ni
 *   de qué clientes tenga hoy.
 *
 *   Lo que se comprueba no son detalles: son las tres formas en que esto podría
 *   hacer daño de verdad.
 *
 *     1. Que un ERP caído NO vacíe el padrón.
 *     2. Que un cliente que desaparece de Quiter se desactive, no se borre,
 *        porque hay cotizaciones viejas firmadas a su nombre.
 *     3. Que los clientes inventados del seed se apaguen solo cuando ya hay
 *        clientes de verdad que los sustituyan.
 *
 * NECESITA la base local con el esquema aplicado (`npm run db:setup`).
 */
import http from 'node:http';

// OJO con el orden: `env.js` lee process.env UNA sola vez, al cargarse, y los
// `import` de arriba se ejecutan antes que cualquier línea de este archivo.
// Por eso todo lo del sistema se importa abajo, con import() dinámico, ya con
// QUITER_BASE_URL apuntando a la API falsa. Con un import normal, el sistema
// arrancaría creyendo que no hay ERP configurado y esta prueba no probaría nada.

let fallos = 0;
const check = (nombre, condicion, extra = '') => {
  console.log(`${condicion ? '  ✓' : '  ✗'} ${nombre}${extra ? ` ${extra}` : ''}`);
  if (!condicion) fallos += 1;
};

// ─── API falsa ───────────────────────────────────────────────────────────────
// `respuesta` se cambia entre pruebas para simular cada escenario.
let respuesta = { estado: 200, cuerpo: [] };

const servidor = http.createServer((req, res) => {
  if (!req.url.startsWith('/api/clientes')) {
    res.writeHead(404).end('{}');
    return;
  }
  if (respuesta.estado !== 200) {
    res.writeHead(respuesta.estado, { 'Content-Type': 'application/json' }).end('{"error":"falla simulada"}');
    return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json' })
     .end(JSON.stringify(respuesta.cuerpo));
});

await new Promise((listo) => servidor.listen(0, '127.0.0.1', listo));
const PUERTO = servidor.address().port;

// El ERP se configura ANTES de importar nada que lo lea: env.js se evalúa una
// sola vez, al cargarse.
process.env.QUITER_BASE_URL = `http://127.0.0.1:${PUERTO}`;

const { cerrarPool, query } = await import('../src/config/db.js');
const { sincronizarClientes, buscarClientes, estadoPadron } =
  await import('../src/services/clientes.service.js');

/** Cómo responde la API de Quiter: nombres de campo en mayúsculas y todo. */
const comoQuiter = (codigo, nombre, ciudad = 'TORREÓN', estado = 'COAHUILA') => ({
  Codigo: codigo, Cliente: nombre, NombreCompleto: nombre,
  Direccion: 'AV. SIEMPRE VIVA 100', Ciudad: ciudad, Estado: estado,
  CP: '27000', Pais: 'MEXICO', Venta_Mes: 12345.67, EsCartera: true,
});

// Punto de partida conocido: los clientes de demostración del seed.
await query("UPDATE clientes SET activo = TRUE WHERE origen = 'DEMO'");
await query("DELETE FROM clientes WHERE origen = 'QUITER'");

console.log('\n== Primera sincronización ==');

respuesta = {
  estado: 200,
  cuerpo: [
    comoQuiter('5058', 'FERNANDO DE LOS SANTOS GALINDO', 'PIEDRAS NEGRAS'),
    comoQuiter('5038', 'JUAN CARLOS TOVAR GUAJARDO', 'VALLE DE ZARAGOZA'),
    comoQuiter('1201', 'TRANSPORTES RAPIDOS DE LA LAGUNA'),
    // Basura que la API puede traer y que no debe entrar a la base.
    { Codigo: '', Cliente: 'SIN CODIGO' },
    { Codigo: '9999', Cliente: '' },
  ],
};

const primera = await sincronizarClientes();
check('Sincroniza', primera.ok === true, primera.motivo ?? '');
check('Entran solo los que traen código y nombre', primera.total === 3, `(${primera.total})`);

const padron = await estadoPadron();
check('El padrón queda con 3 clientes de Quiter', padron.de_quiter === 3, `(${padron.de_quiter})`);
check('Los clientes inventados se apagaron', padron.de_demo === 0, `(${padron.de_demo} activos)`);

const demoSiguen = await query("SELECT COUNT(*) AS n FROM clientes WHERE origen = 'DEMO'");
check('...pero NO se borraron: sus folios viejos siguen teniendo a quién apuntar',
  Number(demoSiguen[0].n) > 0, `(${demoSiguen[0].n} inactivos)`);

console.log('\n== Buscador ==');

const porNombre = await buscarClientes('transportes');
check('Encuentra por nombre', porNombre.clientes.length === 1
  && porNombre.clientes[0].nombre.includes('TRANSPORTES'));

const porCodigo = await buscarClientes('5058');
check('Encuentra por código', porCodigo.clientes.length === 1
  && porCodigo.clientes[0].codigo_erp === '5058');

const minusculas = await buscarClientes('juan carlos');
check('No distingue mayúsculas', minusculas.clientes.length === 1);

const trajoCiudad = porNombre.clientes[0]?.ciudad;
check('Trae la ciudad, para poder distinguir homónimos', Boolean(trajoCiudad), `(${trajoCiudad})`);

const nada = await buscarClientes('zzzzz');
check('Lo que no existe devuelve vacío, no todo', nada.clientes.length === 0);

const todos = await buscarClientes('');
check('Sin texto devuelve el padrón activo', todos.clientes.length === 3);

console.log('\n== Un ERP caído NO puede vaciar el padrón ==');

respuesta = { estado: 500, cuerpo: null };
const caido = await sincronizarClientes();
check('No sincroniza y lo dice', caido.ok === false, `(${caido.motivo})`);

const trasCaida = await estadoPadron();
check('El padrón sigue completo', trasCaida.de_quiter === 3, `(${trasCaida.de_quiter})`);

console.log('\n== Un padrón vacío se trata como respuesta sospechosa ==');

respuesta = { estado: 200, cuerpo: [] };
const vacio = await sincronizarClientes();
check('Se niega a aplicarlo', vacio.ok === false, `(${vacio.motivo})`);
check('Y no apaga a nadie', (await estadoPadron()).de_quiter === 3);

console.log('\n== Altas, cambios y bajas ==');

respuesta = {
  estado: 200,
  cuerpo: [
    // Le cambiaron el nombre y la ciudad en Quiter.
    comoQuiter('5058', 'FERNANDO DE LOS SANTOS GALINDO SA DE CV', 'SALTILLO'),
    comoQuiter('1201', 'TRANSPORTES RAPIDOS DE LA LAGUNA'),
    // Nuevo.
    comoQuiter('7777', 'ACEROS DEL NORTE SA DE CV', 'MONCLOVA'),
    // '5038' ya no viene: se dio de baja en Quiter.
  ],
};

const segunda = await sincronizarClientes();
check('Sincroniza otra vez', segunda.ok === true);
check('Cuenta el alta nueva', segunda.nuevos === 1, `(${segunda.nuevos})`);
check('Cuenta la baja', segunda.desactivados === 1, `(${segunda.desactivados})`);

const cambiado = await query(
  "SELECT nombre, ciudad FROM clientes WHERE codigo_erp = '5058'",
);
check('Actualiza el nombre que cambió en Quiter',
  cambiado[0].nombre.endsWith('SA DE CV'), `(${cambiado[0].nombre})`);
check('Y también la ciudad', cambiado[0].ciudad === 'SALTILLO', `(${cambiado[0].ciudad})`);

const dadoDeBaja = await query(
  "SELECT activo FROM clientes WHERE codigo_erp = '5038'",
);
check('El que ya no está en Quiter se desactiva', dadoDeBaja[0].activo === false);
check('...pero sigue existiendo, no se borró', dadoDeBaja.length === 1);

const buscarBaja = await buscarClientes('JUAN CARLOS');
check('Y ya no aparece en el buscador', buscarBaja.clientes.length === 0);

console.log('\n== Un cliente que vuelve a Quiter, vuelve a estar activo ==');

respuesta.cuerpo.push(comoQuiter('5038', 'JUAN CARLOS TOVAR GUAJARDO', 'VALLE DE ZARAGOZA'));
await sincronizarClientes();
const revivido = await query("SELECT activo FROM clientes WHERE codigo_erp = '5038'");
check('Se reactiva solo', revivido[0].activo === true);

console.log(`\n${fallos === 0 ? 'CLIENTES: TODAS LAS PRUEBAS PASARON ✓' : `CLIENTES: ${fallos} PRUEBA(S) FALLARON ✗`}\n`);

servidor.close();
await cerrarPool();
process.exit(fallos === 0 ? 0 : 1);
