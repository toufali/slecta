import { movieCard } from '../../../components/movieCard.js'

const list = movies => movies.map(movie => `<li>${movieCard(movie)}</li>`).join('')

export const movieList = data => `
<link rel='stylesheet' href='/styles/partials/movieList.css' type='text/css'>
<ul class='movies-list'>
${list(data.movies)}
</ul>
`