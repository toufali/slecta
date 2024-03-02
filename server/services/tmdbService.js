import env from "../env.js"

const { TMDB_TOKEN, TMDB_API_URL } = env
const headers = {
  accept: 'application/json',
  Authorization: `Bearer ${TMDB_TOKEN}`
}

class TmdbService {
  countMin = 10 // minimum vote count
  language = 'en-US' // TODO: base on user/browser preference
  includeAdult = false
  includeVideo = false // "video" content is not theatrically released and may include: compilations, sport events, concerts, plays, fitness video, how-to, etc
  sort = 'primary_release_date.desc'
  region = 'US'
  providerPriority = [
    8, // Netflix
    10, // Amazon Video
    337, // Disney+
    2, // Apple TV
    15, // Hulu
    1899, // Max
    7, // Vudu
    386, // Peacock
    192, // YouTube
    531, // Paramount+
    9, // Amazon Prime Video
    188, // YouTube Premium
    207, // Roku Channel    
  ]
  providerHidden = [
    3, // Google Play Movies
  ]
  config
  genres
  ratings

  async init() {
    const [config, genres, ratings] = await Promise.all([this.#getConfig(), this.#getGenres(), this.#getRatings()])

    this.config = config
    this.genres = genres
    this.ratings = ratings[this.region]
    console.info('TMDB init complete.')
  }

  async #getConfig() {
    let config
    try {
      // TODO: use Redis to store this, especially for offline
      console.log('TMDB_API_URL:', TMDB_API_URL)
      const res = await fetch(`${TMDB_API_URL}/configuration`, { headers })

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
  }

  async #getGenres() {
    let genres
    try {
      // TODO: use Redis to store this, especially for offline
      const res = await fetch(`${TMDB_API_URL}/genre/movie/list?language=${this.language}`, { headers })

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
  }

  async #getRatings() {
    let ratings
    try {
      // TODO: use Redis to store this, especially for offline
      const res = await fetch(`${TMDB_API_URL}/certification/movie/list`, { headers })

      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);

      const { certifications } = await res.json()
      ratings = certifications

    } catch (e) {
      console.error("Error getting TMDB certifications (ratings):", e)
    }
    return ratings
  }

  async getMovies(query) {
    let movies

    const params = {
      page: query.page ?? 1,
      include_adult: this.includeAdult,
      include_video: this.includeVideo,
      sort_by: query.sort ?? this.sort,
      'primary_release_date.lte': new Date(),
      'vote_count.gte': query.count ?? this.countMin,
      with_genres: Array.isArray(query.wg) ? query.wg.join('|') : query.wg,
      without_genres: query.wog,
      certification: Array.isArray(query.wr) ? query.wr.join('|') : query.wr,
      certification_country: this.region,
      watch_region: this.region,
      with_watch_monetization_types: query.streaming ? 'buy|free|flatrate|rent' : ''
    }

    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === '') {
        delete params[key]
      }
    }

    try {
      const res = await fetch(`${TMDB_API_URL}/discover/movie?${new URLSearchParams(params)}`, { headers })

      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);

      const json = await res.json()
      movies = json.results.map(item => new Object({
        id: item.id,
        title: item.title,
        genres: item.genre_ids.map(id => this.genres.get(id)),
        releaseDate: item.release_date,
        posterThumb: `${this.config.images.secure_base_url}${this.config.images.poster_sizes[0]}${item.poster_path}`,
        overview: item.overview,
        tmdbScore: item.vote_average,
        tmdbScoreCount: item.vote_count,
        popularity: item.popularity
      }))

    } catch (e) {
      console.error("Error getting TMDB movies:", e)
    }

    return movies
  }

  async getMovieDetail(id) {
    let movie
    const params = {
      append_to_response: 'videos,release_dates,watch/providers,external_ids'
    }

    try {
      // https://api.themoviedb.org/3/movie/157336?append_to_response=videos,images
      const res = await fetch(`${TMDB_API_URL}/movie/${id}?${new URLSearchParams(params)}`, { headers })

      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);

      const json = await res.json()
      let providers = json['watch/providers'].results[this.region]

      if (providers) {
        // reshape, reduce, and mutate data
        const providerPriority = this.providerPriority.toReversed()
        const thisClass = this

        providers = Object.values(providers)
          .flat()
          .filter(function (item) {
            if (!item.provider_id) return // not a valid provider if no ID
            if (this.has(item.provider_id)) return // already in set
            if (thisClass.providerHidden.includes(item.provider_id)) return // hide obsolete providers

            item.logoUrl = thisClass.config.images.secure_base_url + thisClass.config.images.logo_sizes[0] + item.logo_path
            this.add(item.provider_id)
            return true
          }, new Set())
          .sort((a, b) => {
            const j = providerPriority.indexOf(a.provider_id)
            const k = providerPriority.indexOf(b.provider_id)
            return k - j
          })
      }
      const rating = json.release_dates.results.find(item => item.iso_3166_1 === this.region)?.release_dates.find(release => release.certification !== '')?.certification ?? ''
      const yt = json.videos.results.filter(item => /youtube/i.test(item.site))
      const ytTrailer = yt.find(item => /trailer/i.test(item.type)) || yt.find(item => /teaser|clip/i.test(item.type))

      movie = {
        tmdbId: json.id,
        imdbId: json.external_ids.imdb_id,
        wikiId: json.external_ids.wikidata_id,
        title: json.title,
        overview: json.overview,
        releaseDate: json.release_date,
        tmdbScore: Math.round(json.vote_average * 10),
        rating,
        runtime: json.runtime,
        languages: json.spoken_languages.map(lang => lang.english_name).join(', '),
        genres: json.genres.map(genre => genre.name).join(', '),
        providers,
        backdropUrl: this.config.images.secure_base_url + this.config.images.backdrop_sizes[2] + json.backdrop_path,
        ytTrailerId: ytTrailer?.key
      }
    } catch (e) {
      console.error("Error fetching data:", e);
    }
    // console.log(movie)
    return movie
  }
}

export default new TmdbService()