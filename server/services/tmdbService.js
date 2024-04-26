import env from "../env.js"
import redis from "./redisService.js"

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
  imgConfig
  genres
  ratings

  async init() {
    const [imgConfig, genres, ratings] = await Promise.all([this.#getImgConfig(), this.#getGenres(), this.#getRatings()])
    this.imgConfig = imgConfig
    this.genres = genres
    this.ratings = ratings
    console.info('TMDB initialized:', Boolean(this.imgConfig && this.genres && this.ratings))
    console.info('- from cache:', Boolean(this.imgConfig.cacheHit && this.genres.cacheHit && this.ratings.cacheHit))
  }

  async #getImgConfig() {
    const url = `${TMDB_API_URL}/configuration`

    let imgConfig = await redis.getCache(url)
    if (imgConfig) return imgConfig

    try {
      const res = await fetch(url, { headers })

      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);

      const { images } = await res.json()
      imgConfig = images
      redis.setCache(url, imgConfig)
    } catch (e) {
      console.error("Error getting TMDB imgConfig:", e)
      console.info('Fallback using mock imgConfig.')
      imgConfig = {
        base_url: 'http://image.tmdb.org/t/p/',
        secure_base_url: 'https://image.tmdb.org/t/p/',
        backdrop_sizes: ['w300', 'w780', 'w1280', 'original'],
        logo_sizes: ['w45', 'w92', 'w154', 'w185', 'w300', 'w500', 'original'],
        poster_sizes: ['w92', 'w154', 'w185', 'w342', 'w500', 'w780', 'original'],
        profile_sizes: ['w45', 'w185', 'h632', 'original'],
        still_sizes: ['w92', 'w185', 'w300', 'original']
      }
    }
    return imgConfig
  }

  async #getGenres() {
    const url = `${TMDB_API_URL}/genre/movie/list?language=${this.language}`

    let genres = await redis.getCache(url)
    if (genres) return genres

    try {
      const res = await fetch(url, { headers })

      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);

      const { genres: genresArr } = await res.json()

      genres = new Map(genresArr.map(genre => [genre.id, genre.name]))
      redis.setCache(url, genres, 60 * 60 * 24)
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
    const url = `${TMDB_API_URL}/certification/movie/list`

    let ratings = await redis.getCache(url)
    if (ratings) return ratings

    try {
      const res = await fetch(url, { headers })

      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);

      const { certifications } = await res.json()
      ratings = certifications[this.region]
      ratings.sort((a, b) => a.order - b.order)

      redis.setCache(url, ratings)
    } catch (e) {
      console.error("Error getting TMDB certifications (ratings):", e)
    }
    return ratings
  }

  async getMovies(query) {
    const params = {
      // TODO: these params were based on deprecated filter and should be revisited
      page: query?.page ?? 1,
      include_adult: this.includeAdult,
      include_video: this.includeVideo,
      sort_by: query?.sort ?? this.sort,
      'primary_release_date.lte': new Date().toISOString().substring(0, 10),
      'primary_release_date.gte': new Date(new Date().setFullYear(new Date().getFullYear() - 1)).toISOString().substring(0, 10),
      'vote_count.gte': query?.count ?? this.countMin,
      with_genres: Array.isArray(query?.wg) ? query?.wg.join('|') : query?.wg,
      without_genres: query?.wog,
      certification: Array.isArray(query?.wr) ? query?.wr.join('|') : query?.wr,
      certification_country: this.region,
      watch_region: this.region,
      with_watch_monetization_types: query?.streaming ? 'buy|free|flatrate|rent' : ''
    }

    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === '') {
        delete params[key]
      }
    }

    const urlParams = new URLSearchParams(params)
    const url = `${TMDB_API_URL}/discover/movie?${urlParams}`
    const cacheKey = `movies?${urlParams}`

    let data = await redis.getCache(cacheKey)
    if (data) return data

    try {
      const res = await fetch(url, { headers })

      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);

      const json = await res.json()

      data = {
        movies: json.results.map(item => new Object({
          id: item.id,
          title: item.title,
          genres: item.genre_ids.map(id => this.genres.get(id)),
          releaseDate: item.release_date,
          posterThumb: `${this.imgConfig.secure_base_url}${this.imgConfig.poster_sizes[0]}${item.poster_path}`,
          overview: item.overview,
          tmdbScore: item.vote_average,
          tmdbScoreCount: item.vote_count,
          popularity: item.popularity,
        }))
      }

      data.allGenres = this.genres
      data.withGenres = params.with_genres
      data.allRatings = this.ratings
      data.withRatings = params.certification
      data.sort = params.sort_by

      redis.setCache(cacheKey, data)
      return data
    } catch (e) {
      console.error("Error fetching data:", e);
    }
  }

  async getMovieDetail(id) {
    const params = {
      append_to_response: 'videos,release_dates,watch/providers,external_ids'
    }
    const url = `${TMDB_API_URL}/movie/${id}?${new URLSearchParams(params)}`
    const cacheKey = `movies/${id}`

    let movie = await redis.getCache(cacheKey)
    if (movie) return movie

    try {
      const res = await fetch(url, { headers })

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

            item.logoUrl = thisClass.imgConfig.secure_base_url + thisClass.imgConfig.logo_sizes[0] + item.logo_path
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
        backdropUrl: this.imgConfig.secure_base_url + this.imgConfig.backdrop_sizes[2] + json.backdrop_path,
        ytTrailerId: ytTrailer?.key
      }
      redis.setCache(cacheKey, movie)
      return movie
    } catch (e) {
      console.error("Error fetching data:", e);
    }
  }
}

export default new TmdbService()