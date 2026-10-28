# Farestey Template

Descargador de plantillas y PNG de Roblox por ID. Escribes un ID (o pegas un enlace del catálogo) y la página te muestra el PNG exacto para descargarlo.

## Cómo usarlo en tu computadora

1. Instala Node.js 18 o más nuevo (`node -v` te dice la versión).
2. En esta carpeta ejecuta: `node server.js`
3. Abre http://localhost:3000

No necesita instalar paquetes.

## Cómo publicarlo para que cualquier persona lo use con un enlace

El servidor es un solo archivo, así que funciona en Render, Railway o cualquier hosting que ejecute Node:

- Comando de inicio: `node server.js`
- Versión de Node: 18 o superior
- Variable `TRUST_PROXY=1` (para que el límite de uso cuente a cada persona por separado)
- Variable opcional `ROBLOSECURITY` con la cookie de una cuenta de Roblox (ver advertencia abajo)

Con Render: sube la carpeta a un repositorio de GitHub (el archivo `.gitignore` ya evita subir `cookie.txt`), crea un **Blueprint** nuevo en render.com apuntando a ese repositorio y escribe el valor de `ROBLOSECURITY` cuando lo pida (o déjalo vacío).

### Advertencia sobre la cookie en un servidor público

Con la cookie puesta, cualquier persona con el enlace descarga usando esa cuenta. Por eso:

- Nunca uses tu cuenta principal. Usa una cuenta aparte, sin nada privado y sin Robux.
- Esa cookie queda guardada en el servicio de hosting.
- Roblox puede cerrar la cuenta o invalidar la cookie en cualquier momento.
- Sin cookie, la página funciona con los recursos que Roblox deja descargar sin sesión (puede que algunos IDs den error).

El límite de uso es de 120 peticiones por minuto por persona (se cambia con la variable `RATE_LIMIT`). En el servidor público el diagnóstico `/api/diag` queda apagado.

## Imágenes decorativas (opcional)

Si pones `decor-left.png` y/o `decor-right.png` dentro de `public/`, aparecen a los lados del título. Si no existen, no se muestra nada.

## Si Roblox dice que el recurso es privado o requiere sesión

El servidor prueba varios caminos de Roblox y muestra el detalle de lo que respondió cada uno. Para ver ese detalle de un ID escribe en el navegador:

`http://localhost:3000/api/diag?id=EL_ID`

Si tu cuenta de Roblox sí puede ver ese recurso, puedes activar tu sesión (solo en tu computadora):

1. Entra a roblox.com con tu cuenta en Firefox o Chrome.
2. Pulsa F12 → pestaña **Almacenamiento** (Firefox) o **Application** (Chrome) → **Cookies** → `https://www.roblox.com`.
3. Copia el valor de la cookie `.ROBLOSECURITY`.
4. Crea un archivo llamado `cookie.txt` junto a `server.js` y pega ahí solo ese valor.
5. Apaga el servidor (`Ctrl + C`) y vuelve a encenderlo (`node server.js`). Debe decir "Sesión de Roblox: activada".

Cuidado: esa cookie da acceso a tu cuenta. No la compartas con nadie, no subas `cookie.txt` a internet ni a un hosting, y úsala solo en tu computadora. Si la cuenta no tiene acceso a un recurso, ninguna herramienta puede descargarlo.

## Notas

- Funciona con recursos públicos: ropa (camisas, pantalones, camisetas), calcomanías e imágenes. Los recursos privados o eliminados muestran un aviso.
- Si el ID es de una prenda del catálogo, el servidor sigue la plantilla hasta el PNG real y muestra también el ID de esa imagen.
