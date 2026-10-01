import { scoreBadge } from '../../../client/src/scripts/components/scoreBadge.js'

const sources = [
  ['Rotten Tomatoes critics', '91%'],
  ['Rotten Tomatoes audience', '41%'],
  ['Metacritic', '84'],
  ['IMDb', '6.8']
]

// Nine of ten at 6 or above, averaging 7
const critics = [10, 9, 8, 7, 7, 6, 6, 6, 6, 5]

const steps = [
  ['Gather', 'We get the latest critic and audience ratings from top review sites.'],
  ['Compare apples to apples', 'A percent who “liked it” and an average score measure different things; each goes on the same scale first.'],
  ['Weigh the evidence', 'Our algorithm weighs each source by count and other important factors. A title with only a few ratings is marked low-confidence until more arrive.']
]

const bands = [
  [89, false, '80 and up', 'Worth your time!'],
  [75, false, '65 to 79', 'Could go either way – you’re the tiebreaker.'],
  [52, false, 'Below 65', 'Time you won’t get back.'],
  [67, true, 'Low confidence', 'Not enough ratings to be sure.'],
  [undefined, false, 'No score', 'Too new or too niche to be rated yet.']
]

// As character references, which browsers decode and most address harvesters do not
const EMAIL = [...'hello@slecta.com'].map(char => `&#${char.charCodeAt(0)};`).join('')

export const about = () => `
<article>
  <section id='what'>
    <h1 class='page-description'>Slecta blends a title’s reviews into <b>one balanced score</b>, tells you <b>where it’s streaming</b>, and provides <b>trailers without ads</b>.</h1>
    <figure class='combine'>
      <figcaption><cite>Star Wars: The Last Jedi</cite>, September 2026</figcaption>
      <ul>${sources.map(([name, value]) => `<li><span>${name}</span><b>${value}</b></li>`).join('')}</ul>
      <div>${scoreBadge(74)}<span>Slecta</span></div>
    </figure>
    <p>Slecta decides overall consensus, so you don’t have to check several sites or do the math.</p>
  </section>

  <section id='reading'>
    <h2>How do I read the score?</h2>
    <ul class='bands'>${bands.map(([score, few, range, meaning]) => `<li>${scoreBadge(score, few, score === undefined)}<p><b>${range}</b> ${meaning}</p></li>`).join('')}</ul>
  </section>

  <section id='score'>
    <h2>How is the score calculated?</h2>
    <p>Review sites count differently. Rotten Tomatoes reports the share of critics who liked a film, so a 6 out of 10 counts the same as a 10. Metacritic averages their scores.</p>
    <figure class='critics' data-hold>
      <figcaption>Each card is one critic’s score out of 10. <br>Anything 6 or higher counts as liked.</figcaption>
      <ol>${critics.map((score, i) => `<li class='${score >= 6 ? 'liked' : 'disliked'}' style='--i: ${i}'><b><span>${score}</span></b></li>`).join('')}</ol>
      <dl>
        <div><dt>Critics who “liked” it</dt><dd>90%<small>(Rotten Tomatoes)</small></dd></div>
        <div><dt>Average critic score</dt><dd>70<small>(Metacritic)</small></dd></div>
      </dl>
    </figure>
    <p>Slecta gives a more accurate score in three steps:</p>
    <ol class='steps'>${steps.map(([title, text]) => `<li><b>${title}</b><p>${text}</p></li>`).join('')}</ol>
  </section>

  <section id='install'>
    <h2>Can I install it?</h2>
    <p>Yes. Add Slecta to your home screen and it opens full-screen, like an app.</p>
    <ul class='callout'>
      <li><b>iPhone and iPad</b> Tap Share (inside the ••• menu on iOS 26), then Add to Home Screen. Works in Safari, Chrome, Firefox and Edge.</li>
      <li><b>Android</b> Open the browser menu and tap Install app or Add to Home screen.</li>
      <li><b>Computer</b> In Chrome or Edge, click the install icon at the right of the address bar. In Safari on a Mac, choose File, then Add to Dock.</li>
    </ul>
  </section>

  <section id='credits'>
    <h2>Credits</h2>
    <p>Made by A Toufali · <a href='mailto:${EMAIL}'>${EMAIL}</a></p>
    <p><img src='/images/tmdb.svg' alt='TMDB'> This website uses TMDB and the TMDB APIs but is not endorsed, certified, or otherwise approved by TMDB.</p>
    <p>Streaming data from JustWatch.</p>
    <p>Information courtesy of IMDb (https://www.imdb.com). Used with permission.</p>
    <p>Slecta is not affiliated with or endorsed by Rotten Tomatoes, Metacritic, or IMDb.</p>
  </section>
</article>
`

about.styles = '/styles/partials/about.css'
