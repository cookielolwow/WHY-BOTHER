import { defineConfig } from 'vite';

// En desarrollo servimos desde la RAÍZ (http://localhost:5173/),
// porque el servidor de Vite ya corre dentro de la carpeta del proyecto.
// Solo al COMPILAR (build) usamos la subcarpeta que exige GitHub Pages.
//
// Así la URL local siempre funciona sin escribir la subcarpeta a mano.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/WHY-BOTHER/' : '/',
}));