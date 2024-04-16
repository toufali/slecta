import { movieCard } from '../../../client/src/scripts/components/movieCard.js'

export const movieList = movies => `
<link rel='stylesheet' href='/styles/partials/movieList.css' type='text/css'>
<ul class='movies-list'>
${movies.map(movie => `<li>${movieCard(movie)}</li>`).join('')}
</ul>
`