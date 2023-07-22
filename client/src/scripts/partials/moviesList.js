import '../components/movieCard.js'

const form = document.querySelector('[data-partial="moviesList"] form')
const list = document.querySelector('[data-partial="moviesList"] ul')
// const state = new Proxy({
//   searchParams: null,
// }, {
//   set(target, key, value) {
//     if (target[key] !== value) {
//       target[key] = value
//       render()
//     }

//     return true
//   }
// })


form.addEventListener('change', handleChange)
form.dispatchEvent(new Event('change'))

async function handleChange() {
  const searchParams = new URLSearchParams(new FormData(form))
  const data = await getMovieData(searchParams)

  renderMovieList(data)
  updateUrl(searchParams)
}

async function getMovieData(searchParams) {
  const res = await fetch(`${form.action}?${searchParams}`)
  const data = await res.json()

  return data
}

function renderMovieList(data) {
  const movieItems = []
  const { results: movies } = data

  movies.forEach(movie => {
    const item = document.createElement('li')
    const movieCard = document.createElement('movie-card')

    movieCard.data = {
      id: movie.id,
      title: movie.title,
      releaseDate: movie.release_date,
      imgBaseUrl: data.secureBaseUrl,
      posterSizes: data.posterSizes,
      posterFilename: movie.poster_path,
      voteAverage: movie.vote_average
    }

    item.append(movieCard)
    movieItems.push(item)
  });

  list.replaceChildren(...movieItems)
}

function updateUrl(searchParams) {
  history.replaceState(null, "", `${location.protocol}//${location.host}${location.pathname}?${searchParams}`)
}