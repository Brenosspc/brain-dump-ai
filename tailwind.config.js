// Configuração do Tailwind CSS (build do CSS em public/tailwind.css).
// As classes são procuradas no HTML e no JS do frontend; classes montadas dinamicamente
// (ex.: `bg-${cor}`) não seriam encontradas, então escreva sempre o nome completo.
/** @type {import('tailwindcss').Config} */
export default {
  content: ["./public/index.html", "./public/app.js"],
  theme: {
    extend: {},
  },
  plugins: [],
};
