import env from "../env.js"

const { TMDB_TOKEN } = env
const apiUrl = 'https://api.themoviedb.org/3'
const headers = {
  accept: 'application/json',
  Authorization: `Bearer ${TMDB_TOKEN}`
}
const defaults = {
  scoreMin: 6,
  countMin: 100,
  language: 'en-US',
  includeAdult: false,
  includeVideo: false, // true value doesn't work as of this writing
  dateMin: `${new Date().getFullYear() - 1}-01-01`,
  sort: 'vote_average.desc',
  region: 'US',
  config: null,
  genres: null,
  ratings: null
}

export const tmdb = {
  defaults,
  async init() {
    const [config, genres, ratings] = await Promise.all([this.getConfig(), this.getGenres(), this.getRatings()])

    defaults.config = config
    defaults.genres = genres
    defaults.ratings = ratings[defaults.region]
    console.info('TMDB init complete.')
  },

  async getConfig() {
    let config
    try {
      // TODO: use Redis to store this, especially for offline
      const res = await fetch(`${apiUrl}/configuration`, { headers })

      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);

      config = await res.json() 
    } catch (e) {
      console.error("Error getting TMDB config:", e)
      console.info('Fallback using mock config.')
      config = {
        images: {
          base_url: 'http://image.tmdb.org/t/p/',
          secure_base_url: 'https://image.tmdb.org/t/p/',
          backdrop_sizes: ['w300', 'w780', 'w1280', 'original'],
          logo_sizes: ['w45', 'w92', 'w154', 'w185', 'w300', 'w500', 'original'],
          poster_sizes: ['w92', 'w154', 'w185', 'w342', 'w500', 'w780', 'original'],
          profile_sizes: ['w45', 'w185', 'h632', 'original'],
          still_sizes: ['w92', 'w185', 'w300', 'original']
        }
      }
    }
    return config
  },

  async getGenres() {
    let genres
    try {
      // TODO: use Redis to store this, especially for offline
      const res = await fetch(`${apiUrl}/genre/movie/list?language=${defaults.language}`, { headers })

      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);

      const { genres: genresArr } = await res.json()

      genres = new Map(genresArr.map(genre => [genre.id, genre.name]))
    } catch (e) {
      console.error("Error getting TMDB genres:", e)
      console.info('Fallback using mock genres data.')
      genres = new Map([
        [28, 'Action'],
        [12, 'Adventure'],
        [16, 'Animation'],
        [35, 'Comedy'],
        [80, 'Crime'],
        [99, 'Documentary'],
        [18, 'Drama'],
        [10751, 'Family'],
        [14, 'Fantasy'],
        [36, 'History'],
        [27, 'Horror'],
        [10402, 'Music'],
        [9648, 'Mystery'],
        [10749, 'Romance'],
        [878, 'Science Fiction'],
        [10770, 'TV Movie'],
        [53, 'Thriller'],
        [10752, 'War'],
        [37, 'Western']])
    }
    return genres
  },

  async getRatings() {
    let ratings
    try {
      // TODO: use Redis to store this, especially for offline
      const res = await fetch(`${apiUrl}/certification/movie/list`, { headers })

      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);

      const { certifications } = await res.json()
      ratings = certifications

    } catch (e) {
      console.error("Error getting TMDB certifications (ratings):", e)
    }
    return ratings
  },

  async getMovies(query) {
    let movies
    const years = query.years ? query.years.split(',') : []
    const dateMin = years[0] ? `${years[0]}-01-01` : defaults.dateMin
    const dateMax = years[1] ? `${years[1]}-12-31` : undefined
    const params = {
      include_adult: defaults.includeAdult,
      include_video: defaults.includeVideo,
      'primary_release_date.gte': dateMin,
      'primary_release_date.lte': dateMax,
      sort_by: query.sort ?? defaults.sort,
      'vote_average.gte': query.score ? query.score / 10 : defaults.scoreMin,
      'vote_count.gte': query.count ?? defaults.countMin,
      with_genres: Array.isArray(query.wg) ? query.wg.join('|') : query.wg,
      without_genres: query.wog,
      certification: Array.isArray(query.wr) ? query.wr.join('|') : query.wr,
      certification_country: defaults.region,
    }

    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === '') {
        delete params[key]
      }
    }

    try {
      // https://api.themoviedb.org/3/discover/movie?include_adult=false&include_video=true&language=en-US&page=1&release_date.lte=2023-07-06&sort_by=popularity.desc&with_genres=878';
      const res = await fetch(`${apiUrl}/discover/movie?${new URLSearchParams(params)}`, { headers })

      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);

      const json = await res.json()
      movies = json.results.map(item => new Object({
        id: item.id,
        title: item.title,
        genres: item.genre_ids.map(id => defaults.genres.get(id)),
        releaseDate: item.release_date,
        posterThumb: `${defaults.config.images.secure_base_url}${defaults.config.images.poster_sizes[0]}/${item.poster_path}`,
        overview: item.overview,
        reviewScore: item.vote_average
      }))
    } catch (e) {
      console.error("Error fetching movies:", e);
      movies = [{
        id: 123,
        title: 'Test Title',
        genres: ['Fantasy Test'],
        releaseDate: '2/10/22',
        posterThumb: `${defaults.config.images.secure_base_url}${defaults.config.images.poster_sizes[0]}/item.poster_path`,
        overview: 'Test overiew.  Lorem ipsum dolor and shit',
        reviewScore: 7
      }]
    }
    return { movies }
  },

  async getMoviesDetail(id) {
    const params = {
      append_to_response: 'videos,release_dates,watch/providers'
    }
    let movie

    try {
      // https://api.themoviedb.org/3/movie/157336?append_to_response=videos,images
      const res = await fetch(`${apiUrl}/movie/${id}?${new URLSearchParams(params)}`, { headers })

      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);

      const json = await res.json()
      let providers = json['watch/providers'].results[defaults.region]
      if (providers) {
        // reshape, reduce, and mutate data
        providers = Object.values(providers)
          .flat()
          .filter(function (item) {
            if (!item.provider_id || this.has(item.provider_id)) return

            item.logoUrl = defaults.config.images.secure_base_url + defaults.config.images.logo_sizes[0] + item.logo_path
            this.add(item.provider_id)
            return true
          }, new Set())
      }
      const rating = json.release_dates.results.find(item => item.iso_3166_1 === defaults.region)?.release_dates.find(release => release.certification !== '')?.certification ?? ''
      const ytTrailer = json.videos.results.filter(item => /youtube/i.test(item.site)).find(item => /trailer|teaser|clip/i.test(item.type))

      movie = {
        id: json.id,
        title: json.title,
        overview: json.overview,
        releaseDate: json.release_date,
        reviewScore: json.vote_average,
        rating,
        runtime: json.runtime,
        languages: json.spoken_languages.map(lang => lang.english_name).join(', '),
        genres: json.genres.map(genre => genre.name).join(', '),
        providers,
        backdropUrl: defaults.config.images.secure_base_url + defaults.config.images.backdrop_sizes[2] + json.backdrop_path,
        ytTrailerId: ytTrailer?.key
      }
    } catch (e) {
      console.error("Error fetching data:", e);
    }
    // console.log(movie)
    return movie
  },

  async getMoviesTrailer(id) {
    try {
      // https://api.themoviedb.org/3/movie/{movie_id}/videos
      const res = await fetch(`${apiUrl}/movie/${id}/videos`, { headers })

      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);

      const json = await res.json()
      const ytTrailers = json.results.filter(item => /youtube/i.test(item.site))
      const trailer = ytTrailers.find(item => /trailer/i.test(item.type)) ?? json.results.find(item => /teaser/i.test(item.type)) ?? json.results.find(item => /clip/i.test(item.type))

      return trailer ?? {}
    } catch (e) {
      console.error("Error fetching data:", e);
      return {}
    }
  }
}
