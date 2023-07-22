export const mainView = data => `
     <!doctype html>
     <html lang=en>
       <head>
         <title>Slector</title>
 
         <meta charset='utf-8'>
         <meta name='viewport' content='width=320, initial-scale=1'>
         <meta name='description' content=''>
         <meta name='twitter:card' content='summary_large_image'>
         <meta name='twitter:title' content=''>
         <meta name='twitter:description' content=''>
         <meta name='twitter:image' content=''>
         <meta property='og:title' content=''>
         <meta property='og:description' content=''>
         <meta property='og:site_name' content=''>
         <meta property='og:type' content='website'>
         <meta property='og:url' content=''>
         <meta property='og:image' content=''>
 
         <link rel='stylesheet' href='/styles/index.css' type='text/css'>
         ${!data.partialStyle ? '' : `<link rel='stylesheet' href='/styles/partials/${data.partial.name}.css' type='text/css'>`}
         <link rel='icon' href='data:,' sizes='16x16'>
         <link rel='icon' href='data:,' sizes='32x32'>
         <link rel='icon' href='data:,' sizes='48x48'>
         <link rel='icon' href='data:,' sizes='96x96'>
         <link rel='icon' href='data:,' sizes='144x144'>
         <link rel='icon' href='data:,' sizes='256x256'>
         <link rel='apple-touch-icon' href='data:,' sizes='180x180'>
 
         <script src='/scripts/index.js' type='module'></script>
         ${!data.partialScript ? '' : `<script src='/scripts/partials/${data.partial.name}.js' type='module'></script>`}
      </head>
       <body>
         <header>
          <h1>Slector</h1>
         </header>
 
         <main data-partial='${data.partial.name}'>
            ${data.partial(data)}
         </main>

         <footer>
          Copyright and stuff
         </footer>
       </body>
     </html>
   `