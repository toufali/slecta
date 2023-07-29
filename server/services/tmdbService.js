import env from "../env.js"

const { TMDB_TOKEN } = env
const apiUrl = 'https://api.themoviedb.org/3'
const headers = {
  accept: 'application/json',
  Authorization: `Bearer ${TMDB_TOKEN}`
}

export const tmdbService = {
  config: null,
  genres: null,
  async init() {
    const [config, genres] = await Promise.all([this.getConfig(), this.getGenres()])

    this.config = config
    this.genres = genres
    console.info('TMDB init complete.')
    console.info('image config:', config.images)
    console.info('genres:', genres)
  },
  async getConfig() {
    try {
      const res = await fetch(`${apiUrl}/configuration`, { headers })

      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);

      return await res.json()
    } catch (error) {
      console.error("Error getting TMDB config:", error);
    }
  },
  async getGenres() {
    try {
      const res = await fetch(`${apiUrl}/genre/movie/list?language=en`, { headers })

      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);

      const { genres } = await res.json()

      return genres
    } catch (error) {
      console.error("Error getting TMDB genres:", error);
    }
  },
  async getMovies(query) {
    const years = query.years.split(',')
    const genres = Array.isArray(query.genres) ? query.genres.join('|') : query.genres
    const params = new URLSearchParams({
      include_adult: false,
      include_video: false,
      language: 'en-US',
      page: 1,
      'primary_release_date.gte': `${years[0]}-01-01`,
      'primary_release_date.lte': `${years[1]}-12-31`,
      sort_by: query.sort,
      'vote_average.gte': query.reviewScore / 10,
      'vote_count.gte': query.reviewCount,
      with_genres: genres
    })

    try {
      console.log('Fetching movies from tmdb using params:', params)
      // https://api.themoviedb.org/3/discover/movie?include_adult=false&include_video=true&language=en-US&page=1&release_date.lte=2023-07-06&sort_by=popularity.desc&with_genres=878';
      const res = await fetch(`${apiUrl}/discover/movie?${params}`, { headers })

      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);

      const json = await res.json()

      return json.results.map(item => new Object({
        id: item.id,
        title: item.title,
        genres: item.genre_ids,
        releaseDate: item.release_date,
        posterThumb: `${this.config.images.secure_base_url}${this.config.images.poster_sizes[0]}/${item.poster_path}`,
        overview: item.overview,
        reviewScore: item.vote_average
      }))
    } catch (error) {
      console.error("Error fetching data:", error);
    }
  },
  async getMoviesDetail(id) {
    try {
      console.log('Fetching movie detail from tmdb.')
      // https://api.themoviedb.org/3/movie/{movie_id}
      const res = await fetch(`${apiUrl}/movie/${id}`, { headers })

      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);

      const json = await res.json()

      json.imgBaseUrl = this.config.images.secure_base_url
      json.posterSizes = this.config.images.poster_sizes
      json.backdropSizes = this.config.images.backdrop_sizes

      return json
    } catch (error) {
      console.error("Error fetching data:", error);
    }
  },
  async getMoviesTrailer(id) {
    try {
      console.log('Fetching movie trailer from tmdb.')
      // https://api.themoviedb.org/3/movie/{movie_id}/videos
      const res = await fetch(`${apiUrl}/movie/${id}/videos`, { headers })

      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);

      const json = await res.json()

      console.log(json)

      const ytTrailers = json.results.filter(item => /youtube/i.test(item.site))
      const trailer = ytTrailers.find(item => /trailer/i.test(item.type)) ?? json.results.find(item => /teaser/i.test(item.type)) ?? json.results.find(item => /clip/i.test(item.type))

      return trailer ?? {}
    } catch (error) {
      console.error("Error fetching data:", error);
    }
  }
}
