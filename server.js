require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios');
const fs = require('fs');
const config = require('./config.json');

const app = express();


app.use((req, res, next) => {
    console.log('\n=== NOUVELLE REQUÊTE ===');
    console.log('\n=== NOUVELLE REQUÊTE ===');
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    console.log('Headers:', JSON.stringify(req.headers, null, 2));
    console.log('Body:', req.body);
    console.log('Query:', req.query);
    console.log('=== DÉBUT DU TRAITEMENT ===');

    // Ajouter un timestamp à la fin du traitement
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        console.log(`=== FIN DU TRAITEMENT (${duration}ms) ===\n`);
    });
    next();
});

// Configuration CORS améliorée
const corsOptions = {
    origin: '*',
    methods: ['GET', 'POST', 'DELETE', 'PUT', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
};

app.use(cors(corsOptions));
console.log('[SERVER] Configuration CORS:', corsOptions);

app.use(express.json());

// Monter les routes dans le bon ordre
console.log('[SERVER] Montage des routes...');

// Version de l'APK - doit correspondre à celle du client
const apkVersion = '3.1.1';  // Doit correspondre exactement au versionName du build.gradle.kts

// Chemin de téléchargement de l'APK
const downloadsPath = path.join(__dirname, 'downloads');
const APK_PATH = path.join(downloadsPath, 'chouftv-latest.apk');

// Configuration du timeout d'Axios
const axiosConfig = {
    timeout: 60000, // 60 secondes
    maxContentLength: Infinity,
    maxBodyLength: Infinity
};

app.get('/api/channels', async (req, res) => {
    try {
        // Restauration de la logique d'authentification originale
        const authUrl = `${config.server_url}player_api.php`;
        const authParams = {
            username: config.username,
            password: config.password
        };
        let authResponse;
        for (let i = 0; i < 3; i++) {
            try {
                console.log('[AUTH] Tentative de connexion au serveur IPTV...');
                authResponse = await axios.get(authUrl, {
                    params: authParams,
                    ...axiosConfig
                });
                if (authResponse.data && authResponse.data.user_info) {
                    console.log('[AUTH] Connexion réussie');
                    break;
                }
            } catch (error) {
                if (i === 2) throw error;
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }
        console.log('[CHANNELS] Début de la récupération des chaînes');

        // 2. Récupération des catégories avec cache
        console.log('[CATEGORIES] Récupération des catégories...');
        const categoriesResponse = await axios.get(authUrl, {
            params: {
                ...authParams,
                action: 'get_live_categories'
            },
            ...axiosConfig
        });

        const categories = categoriesResponse.data.reduce((acc, cat) => {
            if (cat && cat.category_id && cat.category_name) {
                acc[cat.category_id] = cat.category_name;
            }
            return acc;
        }, {});

        console.log(`[CATEGORIES] ${Object.keys(categories).length} catégories récupérées`);

        // 3. Récupération des streams avec gestion des erreurs
        console.log('[CHANNELS] Récupération des streams...');
        const streamsResponse = await axios.get(authUrl, {
            params: {
                ...authParams,
                action: 'get_live_streams'
            },
            ...axiosConfig
        });

        if (!Array.isArray(streamsResponse.data)) {
            throw new Error('Format de réponse invalide pour les streams');
        }

        // 4. Traitement et validation des données
        const processedChannels = streamsResponse.data.map(stream => {
            // Validation et correction des URLs
            let logoUrl = stream.stream_icon || '';
            if (logoUrl && !logoUrl.startsWith('http')) {
                logoUrl = logoUrl.startsWith('/') ?
                    `${config.server_url}${logoUrl.slice(1)}` :
                    `${config.server_url}${logoUrl}`;
            }

            // Validation de l'URL du stream
            const streamUrl = `${config.server_url}live/${config.username}/${config.password}/${stream.stream_id}`;

            return {
                name: stream.name || 'Sans nom',
                category: categories[stream.category_id] || 'Non catégorisé',
                url: streamUrl,
                logo: logoUrl,
                stream_id: stream.stream_id,
                category_id: stream.category_id,
                rating: stream.rating || 0,
                quality: stream.quality || 'HD',
                container_extension: stream.container_extension || 'm3u8'
            };
        });

        // 5. Classification et statistiques
        const classified = {
            tv: processedChannels.filter(ch =>
                !ch.name.toLowerCase().includes('movie') &&
                !ch.name.toLowerCase().includes('film') &&
                !ch.category.toLowerCase().includes('film') &&
                !ch.category.toLowerCase().includes('movie') &&
                !ch.name.toLowerCase().includes('serie') &&
                !ch.name.toLowerCase().includes('séries') &&
                !ch.category.toLowerCase().includes('serie') &&
                !ch.category.toLowerCase().includes('séries')
            ),
            movies: processedChannels.filter(ch =>
                ch.name.toLowerCase().includes('movie') ||
                ch.name.toLowerCase().includes('film') ||
                ch.category.toLowerCase().includes('film') ||
                ch.category.toLowerCase().includes('movie')
            ),
            series: processedChannels.filter(ch =>
                ch.name.toLowerCase().includes('serie') ||
                ch.name.toLowerCase().includes('séries') ||
                ch.category.toLowerCase().includes('serie') ||
                ch.category.toLowerCase().includes('séries')
            )
        };

        // Ajouter des logs pour le débogage des séries
        console.log('\n=== STATISTIQUES DÉTAILLÉES ===');
        console.log(`Total chaînes: ${processedChannels.length}`);
        console.log(`TV: ${classified.tv.length}`);
        console.log(`Films: ${classified.movies.length}`);
        console.log(`Séries: ${classified.series.length}`);
        console.log('\nPremières séries trouvées:');
        classified.series.slice(0, 5).forEach(serie => {
            console.log(`- ${serie.name} (${serie.category})`);
        });
        console.log('===================\n');

        res.json({
            success: true,
            channels: processedChannels,
            stats: {
                total: processedChannels.length,
                tv: classified.tv.length,
                movies: classified.movies.length,
                series: classified.series.length
            }
        });

    } catch (error) {
        console.error('[ERROR]', error.message);
        res.status(500).json({
            success: false,
            error: 'Erreur serveur',
            details: error.message
        });
    }
});

// Endpoint pour vérifier la version
app.get('/api/version', (req, res) => {
    console.log('[VERSION] Client requesting version check');
    console.log('[VERSION] Current APK version:', apkVersion);

    const downloadUrl = `${req.protocol}://${req.get('host')}/downloads/chouftv-latest.apk`;

    res.json({
        version: apkVersion,
        downloadUrl: downloadUrl,
        forceUpdate: false  // Mettre à true seulement pour les mises à jour critiques
    });
});

function buildStreamUrl(baseUrl, username, password, streamId, type = 'live') {
    // Nettoyer l'URL de base
    const cleanBaseUrl = baseUrl.replace(/\/$/, '');

    // Construire l'URL avec plusieurs formats possibles
    const formats = {
        ts: `${cleanBaseUrl}/live/${username}/${password}/${streamId}.ts`,
        m3u8: `${cleanBaseUrl}/live/${username}/${password}/${streamId}.m3u8`,
        mp4: `${cleanBaseUrl}/live/${username}/${password}/${streamId}.mp4`,
        default: `${cleanBaseUrl}/live/${username}/${password}/${streamId}`
    };

    return {
        formats: formats,
        defaultUrl: formats.m3u8
    };
}

app.get('/api/live/:stream_id', async (req, res) => {
    const streamId = req.params.stream_id;

    try {
        const streamUrls = buildStreamUrl(config.server_url, config.username, config.password, streamId);

        // Tester les URLs dans l'ordre
        for (const [format, url] of Object.entries(streamUrls.formats)) {
            try {
                const testResponse = await axios.head(url, {
                    timeout: 5000,
                    validateStatus: (status) => status < 400
                });

                if (testResponse.status === 200) {
                    console.log(`[STREAM] Format ${format} disponible pour ${streamId}`);
                    res.json({
                        success: true,
                        data: {
                            stream_url: url,
                            format: format,
                            alternate_urls: streamUrls.formats,
                            headers: {
                                'User-Agent': 'ExoPlayer',
                                'Accept': '*/*',
                                'Connection': 'keep-alive'
                            }
                        }
                    });
                    return;
                }
            } catch (error) {
                console.warn(`[STREAM] Format ${format} non disponible pour ${streamId}`);
            }
        }

        // Si aucun format ne fonctionne, renvoyer l'URL par défaut
        res.json({
            success: true,
            data: {
                stream_url: streamUrls.defaultUrl,
                format: 'm3u8',
                alternate_urls: streamUrls.formats,
                headers: {
                    'User-Agent': 'ExoPlayer',
                    'Accept': '*/*',
                    'Connection': 'keep-alive'
                }
            }
        });

    } catch (error) {
        console.error('[STREAM] Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Modification similaire pour les films et séries
app.get('/api/movie/:movie_id', async (req, res) => {
    // ... appliquer la même logique que ci-dessus avec type 'movie'
});

app.get('/api/series/:episode_id', async (req, res) => {
    // ... appliquer la même logique que ci-dessus avec type 'series'
});

// Ajouter ces routes avant app.listen
app.get('/api/films', async (req, res) => {
    try {
        console.log('[FILMS] Début de la récupération des films');
        const authUrl = `${config.server_url}player_api.php`;
        const authParams = {
            username: config.username,
            password: config.password
        };

        const response = await axios.get(authUrl, {
            params: {
                ...authParams,
                action: 'get_live_streams'
            },
            ...axiosConfig
        });

        if (!Array.isArray(response.data)) {
            throw new Error('Format de réponse invalide');
        }

        const films = response.data.filter(stream => {
            const name = stream.name.toLowerCase();
            const category = (stream.category_name || "").toLowerCase();
            return name.includes('film') ||
                name.includes('movie') ||
                category.includes('film') ||
                category.includes('movie');
        });

        console.log(`[FILMS] ${films.length} films trouvés`);

        res.json({
            success: true,
            channels: films
        });
    } catch (error) {
        console.error('[FILMS] Erreur:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.get('/api/series', async (req, res) => {
    try {
        console.log('[SERIES] Début de la récupération des séries');
        const authUrl = `${config.server_url}player_api.php`;
        const authParams = { username: config.username, password: config.password };

        // Récupérer les catégories de séries avec fallback en cas d'erreur 404
        let categories = {};
        try {
            const categoriesResponse = await axios.get(authUrl, {
                params: { ...authParams, action: 'get_series_categories' },
                ...axiosConfig
            });
            categories = categoriesResponse.data.reduce((acc, cat) => {
                if (cat && cat.category_id && cat.category_name) {
                    acc[cat.category_id] = cat.category_name;
                }
                return acc;
            }, {});
            console.log(`[SERIES] ${Object.keys(categories).length} catégories séries récupérées`);
        } catch (e) {
            console.warn(`[SERIES] Erreur lors de la récupération des catégories: ${e.message}. Utilisation d'un mapping vide.`);
            categories = {};
        }

        // Récupérer toutes les séries
        console.log('[SERIES] Récupération des séries...');
        const seriesResponse = await axios.get(authUrl, {
            params: { ...authParams, action: 'get_series' },
            ...axiosConfig
        });
        if (!Array.isArray(seriesResponse.data)) {
            throw new Error('Format de réponse invalide pour les séries');
        }

        // Traitement et récupération détaillée pour chaque série
        const seriesPromises = seriesResponse.data.map(async (series) => {
            let seasons = [];
            try {
                const seriesInfo = await axios.get(authUrl, {
                    params: { ...authParams, action: 'get_series_info', series_id: series.series_id },
                    ...axiosConfig
                });
                seasons = Object.entries(seriesInfo.data.episodes || {}).map(([seasonNum, episodes]) => ({
                    number: parseInt(seasonNum),
                    episodes: episodes.map(episode => ({
                        id: `${series.series_id}-s${seasonNum}e${episode.episode_num}`,
                        number: parseInt(episode.episode_num),
                        title: episode.title || `Épisode ${episode.episode_num}`,
                        streamUrl: `${config.server_url}series/${config.username}/${config.password}/${episode.id}.${episode.container_extension}`,
                        thumbnailUrl: episode.info.movie_image || series.cover || 'https://via.placeholder.com/300x450',
                        duration: episode.info.duration || '',
                        overview: episode.info.plot || '',
                        releaseDate: episode.info.releasedate || ''
                    }))
                }));
                seasons.sort((a, b) => a.number - b.number);
            } catch (error) {
                console.error(`[SERIES] Erreur pour ${series.name}: ${error.message}`);
                seasons = [];
            }
            return {
                id: series.series_id.toString(),
                title: series.name,
                category: categories[series.category_id] || 'Non catégorisé',
                categoryId: series.category_id,
                coverUrl: series.cover || 'https://via.placeholder.com/300x450',
                overview: series.plot || '',
                rating: parseFloat(series.rating) || 0,
                genre: series.genre || '',
                director: series.director || '',
                actors: series.cast || '',
                releaseDate: series.releaseDate || '',
                seasons: seasons
            };
        });
        const processedSeries = (await Promise.all(seriesPromises)).filter(series => series !== null);
        const seriesByCategory = processedSeries.reduce((acc, series) => {
            const category = series.category;
            if (!acc[category]) { acc[category] = []; }
            acc[category].push(series);
            return acc;
        }, {});

        res.json({ success: true, series: processedSeries, categories: categories, seriesByCategory: seriesByCategory });
    } catch (error) {
        console.error('[SERIES] Erreur:', error.message);
        res.status(500).json({ success: false, error: error.message, series: [] });
    }
});

app.get('/api/movies', async (req, res) => {
    try {
        console.log('[MOVIES] Début de la récupération des films VOD');
        const authUrl = `${config.server_url}player_api.php`;
        const authParams = {
            username: config.username,
            password: config.password
        };

        // 1. Récupérer d'abord les catégories VOD
        console.log('[MOVIES] Récupération des catégories VOD...');
        const categoriesResponse = await axios.get(authUrl, {
            params: {
                ...authParams,
                action: 'get_vod_categories'
            },
            ...axiosConfig
        });

        // Créer un mapping des catégories
        const categories = categoriesResponse.data.reduce((acc, cat) => {
            if (cat && cat.category_id && cat.category_name) {
                acc[cat.category_id] = cat.category_name;
            }
            return acc;
        }, {});

        console.log(`[MOVIES] ${Object.keys(categories).length} catégories VOD trouvées`);

        // 2. Récupérer les films
        console.log('[MOVIES] Récupération des films VOD...');
        const moviesResponse = await axios.get(authUrl, {
            params: {
                ...authParams,
                action: 'get_vod_streams'
            },
            ...axiosConfig
        });

        if (!Array.isArray(moviesResponse.data)) {
            throw new Error('Format de réponse invalide pour les films');
        }

        // 3. Traiter les films avec leurs catégories et ajuster l'URL
        const movies = moviesResponse.data.map(movie => {
            // Pour les films, toujours utiliser l'extension directement sans m3u8
            const streamUrl = `${config.server_url}movie/${config.username}/${config.password}/${movie.stream_id}.${movie.container_extension}`;
            console.log('[MOVIES] Generated URL:', streamUrl); // Log pour debug

            return {
                id: movie.stream_id.toString(),
                title: movie.name,
                coverUrl: movie.stream_icon || 'https://via.placeholder.com/300x450',
                // URL sans m3u8 pour les films
                streamUrl: streamUrl,
                category: categories[movie.category_id] || 'Non catégorisé',
                categoryId: movie.category_id,
                year: movie.year || extractYear(movie.name) || null,
                quality: movie.quality || 'HD',
                description: movie.description || '',
                duration: movie.duration || '',
                rating: parseFloat(movie.rating) || 0
            };
        });

        // 4. Regrouper les films par catégorie
        const moviesByCategory = movies.reduce((acc, movie) => {
            const category = movie.category;
            if (!acc[category]) {
                acc[category] = [];
            }
            acc[category].push(movie);
            return acc;
        }, {});

        console.log(`[MOVIES] ${movies.length} films VOD traités et catégorisés`);

        res.json({
            success: true,
            movies: movies,
            categories: categories,
            moviesByCategory: moviesByCategory
        });

    } catch (error) {
        console.error('[MOVIES] Erreur:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            movies: []
        });
    }
});

// Fonction pour charger les chaînes IPTV-org
async function loadIPTVOrgChannels(url) {
    try {
        console.log(`[IPTV-ORG] Chargement des chaînes depuis ${url}`);
        const response = await axios.get(url);
        const content = response.data;

        if (!content) {
            console.error('[IPTV-ORG] Contenu vide reçu de', url);
            return [];
        }

        const lines = content.split('\n');
        const channels = [];
        let currentChannel = null;

        for (let line of lines) {
            line = line.trim();

            if (line.startsWith('#EXTINF:')) {
                // Nouvelle chaîne
                const nameMatch = line.match(/,(.+)$/);
                const name = nameMatch ? nameMatch[1].trim() : 'Unknown';

                const logoMatch = line.match(/tvg-logo="([^"]+)"/);
                const logo = logoMatch ? logoMatch[1] : null;

                const groupMatch = line.match(/group-title="([^"]+)"/);
                const group = groupMatch ? groupMatch[1] : null;

                const countryMatch = line.match(/tvg-country="([^"]+)"/);
                const country = countryMatch ? countryMatch[1] : null;

                currentChannel = {
                    name,
                    logo,
                    group,
                    country,
                    url: null
                };
            } else if (line && !line.startsWith('#') && currentChannel) {
                // URL de la chaîne
                currentChannel.url = line;
                channels.push(currentChannel);
                currentChannel = null;
            }
        }

        console.log(`[IPTV-ORG] ${channels.length} chaînes chargées depuis ${url}`);
        return channels;
    } catch (error) {
        console.error('[IPTV-ORG] Erreur lors du chargement des chaînes:', error);
        throw error;
    }
}

// Endpoint pour récupérer toutes les chaînes IPTV-org
app.get('/api/iptv-org/channels', async (req, res) => {
    try {
        console.log('[IPTV-ORG] Début de la récupération des chaînes');
        const allChannels = [];

        // Charger les chaînes par langue
        for (const [lang, url] of Object.entries(config.streaming.iptv_org.channels.languages)) {
            try {
                const channels = await loadIPTVOrgChannels(url);
                channels.forEach(channel => {
                    channel.language = lang;
                    allChannels.push(channel);
                });
            } catch (error) {
                console.error(`Error loading ${lang} channels:`, error);
            }
        }

        // Charger les chaînes par catégorie
        for (const [category, url] of Object.entries(config.streaming.iptv_org.channels.categories)) {
            try {
                const channels = await loadIPTVOrgChannels(url);
                channels.forEach(channel => {
                    if (!channel.category) {
                        channel.category = category;
                    }
                    allChannels.push(channel);
                });
            } catch (error) {
                console.error(`Error loading ${category} channels:`, error);
            }
        }

        // Charger les chaînes par pays
        for (const [country, url] of Object.entries(config.streaming.iptv_org.channels.countries)) {
            try {
                const channels = await loadIPTVOrgChannels(url);
                channels.forEach(channel => {
                    channel.country = country;
                    allChannels.push(channel);
                });
            } catch (error) {
                console.error(`Error loading ${country} channels:`, error);
            }
        }

        // Supprimer les doublons basés sur l'URL
        const uniqueChannels = Array.from(new Map(allChannels.map(channel => [channel.url, channel])).values());

        // Filtrer les chaînes adultes
        const filteredChannels = uniqueChannels.filter(channel => {
            const adultKeywords = ['adult', 'xxx', 'sex', 'porn', '+18', '18+'];
            const name = channel.name.toLowerCase();
            return !adultKeywords.some(keyword => name.includes(keyword));
        });

        console.log(`[IPTV-ORG] ${filteredChannels.length} chaînes chargées`);

        res.json({
            success: true,
            channels: filteredChannels
        });
    } catch (error) {
        console.error('[IPTV-ORG] Error:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur lors de la récupération des chaînes IPTV-org',
            details: error.message
        });
    }
});

// Endpoints pour les chaînes IPTV-org par pays
app.get('/api/iptv-org/channels/countries/:country', async (req, res) => {
    try {
        const country = req.params.country;
        console.log(`[IPTV-ORG] Chargement des chaînes pour le pays: ${country}`);

        const countryUrl = config.streaming.iptv_org.channels.countries[country];
        if (!countryUrl) {
            return res.status(404).json({
                success: false,
                message: `Pays ${country} non trouvé`,
                channels: []
            });
        }

        // Charger et traiter les chaînes
        const channels = await loadIPTVOrgChannels(countryUrl);

        // S'assurer que chaque chaîne a le pays défini
        const processedChannels = channels.map(channel => ({
            ...channel,
            country: country // Forcer le pays pour toutes les chaînes
        }));

        console.log(`[IPTV-ORG] ${processedChannels.length} chaînes chargées pour ${country}`);

        res.json({
            success: true,
            message: `${processedChannels.length} chaînes trouvées pour ${country}`,
            channels: processedChannels
        });
    } catch (error) {
        console.error(`[IPTV-ORG] Erreur lors du chargement des chaînes par pays:`, error);
        res.status(500).json({
            success: false,
            error: `Erreur lors du chargement des chaînes: ${error.message}`
        });
    }
});

// Endpoints pour les chaînes IPTV-org par langue
app.get('/api/iptv-org/channels/languages/:language', async (req, res) => {
    try {
        const language = req.params.language;
        const url = config.streaming.iptv_org.channels.languages[language];

        if (!url) {
            return res.status(404).json({
                success: false,
                message: `Language ${language} not found`,
                channels: []
            });
        }

        const channels = await loadIPTVOrgChannels(url);
        if (!channels || channels.length === 0) {
            return res.json({
                success: true,
                message: `Aucune chaîne trouvée pour la langue ${language}`,
                channels: []
            });
        }

        res.json({
            success: true,
            message: `${channels.length} chaînes chargées pour la langue ${language}`,
            channels: channels
        });
    } catch (error) {
        console.error(`[IPTV-ORG] Error loading ${req.params.language} channels:`, error);
        res.status(500).json({
            success: false,
            message: `Error loading ${req.params.language} channels: ${error.message}`,
            channels: []
        });
    }
});

// Endpoints pour les chaînes IPTV-org par catégorie
app.get('/api/iptv-org/channels/categories/:category', async (req, res) => {
    try {
        const category = req.params.category;
        const url = config.streaming.iptv_org.channels.categories[category];

        if (!url) {
            return res.status(404).json({
                success: false,
                error: `Category ${category} not found`
            });
        }

        const channels = await loadIPTVOrgChannels(url);
        res.json({
            success: true,
            channels: channels
        });
    } catch (error) {
        console.error(`[IPTV-ORG] Error loading ${req.params.category} channels:`, error);
        res.status(500).json({
            success: false,
            error: `Error loading ${req.params.category} channels`,
            details: error.message
        });
    }
});

// Ajouter ces fonctions utilitaires
function determineMovieCategory(title, originalCategory) {
    const titleLower = title.toLowerCase();
    const categories = {
        'Action': ['action', 'combat', 'war', 'guerre'],
        'Animation': ['animation', 'cartoon', 'anime', 'disney', 'pixar'],
        'Comédie': ['comedy', 'comedie', 'comédie', 'humour'],
        'Drame': ['drama', 'drame'],
        'Horreur': ['horror', 'horreur', 'épouvante', 'epouvante'],
        'Science-Fiction': ['sci-fi', 'science fiction', 'sf'],
        'Thriller': ['thriller', 'suspense'],
        'Documentaire': ['documentary', 'documentaire', 'docu'],
        'Famille': ['family', 'famille', 'kids', 'enfant'],
        'Aventure': ['adventure', 'aventure'],
        'Fantasy': ['fantasy', 'fantastique'],
        'Romance': ['romance', 'romantic', 'romantique']
    };

    // Vérifier d'abord la catégorie originale
    if (originalCategory) {
        const categoryLower = originalCategory.toLowerCase();
        for (const [category, keywords] of Object.entries(categories)) {
            if (keywords.some(keyword => categoryLower.includes(keyword))) {
                return category;
            }
        }
    }

    // Sinon, vérifier le titre
    for (const [category, keywords] of Object.entries(categories)) {
        if (keywords.some(keyword => titleLower.includes(keyword))) {
            return category;
        }
    }

    return 'Autres';
}

function extractYear(title) {
    const yearMatch = title.match(/\b(19|20)\d{2}\b/);
    return yearMatch ? parseInt(yearMatch[0]) : null;
}

app.get('/api/vod', async (req, res) => {
    try {
        console.log('[VOD] Début de la récupération des VOD');
        const authUrl = `${config.server_url}player_api.php`;
        const authParams = {
            username: config.username,
            password: config.password,
            action: 'get_vod_streams'  // Utiliser l'endpoint VOD spécifique
        };

        const response = await axios.get(authUrl, { params: authParams, ...axiosConfig });

        if (!Array.isArray(response.data)) {
            throw new Error('Format de réponse invalide');
        }

        const vodContent = response.data.map(stream => ({
            id: stream.stream_id.toString(),
            title: stream.name,
            description: stream.description || '',
            category: stream.category_name || 'Non catégorisé',
            coverUrl: stream.stream_icon || 'https://via.placeholder.com/300x450',
            streamUrl: `${config.server_url}movie/${config.username}/${config.password}/${stream.stream_id}.${stream.container_extension}`,
            year: stream.year || null,
            duration: stream.duration || '',
            rating: parseFloat(stream.rating) || 0,
            quality: stream.quality || 'HD'
        }));

        res.json({
            success: true,
            vod: vodContent
        });
    } catch (error) {
        console.error('[VOD] Erreur:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Fonction pour charger les chaînes IPTV-org
async function loadIPTVOrgChannels(url) {
    try {
        const response = await axios.get(url);
        const m3uContent = response.data;

        // Parse M3U content
        const channels = [];
        const lines = m3uContent.split('\n');
        let currentChannel = null;

        for (let line of lines) {
            line = line.trim();
            console.log('Processing line:', line);

            if (line.startsWith('#EXTINF:')) {
                const channelInfo = {};

                // Extract name (handle parentheses content)
                const nameMatch = line.match(/,([^,]+)$/);
                if (nameMatch) {
                    channelInfo.name = nameMatch[1].trim();
                }

                // Extract logo
                const logoMatch = line.match(/tvg-logo="([^"]+)"/);
                if (logoMatch) {
                    channelInfo.logo = logoMatch[1];
                }

                // Extract category/group
                const groupMatch = line.match(/group-title="([^"]+)"/);
                if (groupMatch) {
                    channelInfo.category = groupMatch[1];
                }

                currentChannel = channelInfo;
            } else if (line.startsWith('http') && currentChannel) {
                currentChannel.url = line;
                channels.push(currentChannel);
                currentChannel = null;

                // Log progress périodiquement
                if (channels.length % 100 === 0) {
                    console.log(`[IPTV-ORG] ${channels.length} chaînes chargées...`);
                }
            }
        }

        // Log statistics about country distribution
        const countryStats = channels.reduce((stats, channel) => {
            stats[channel.country] = (stats[channel.country] || 0) + 1;
            return stats;
        }, {});

        console.log('\n=== Distribution des chaînes par pays ===');
        Object.entries(countryStats)
            .sort(([, a], [, b]) => b - a)
            .forEach(([country, count]) => {
                console.log(`${country}: ${count} chaînes`);
            });
        console.log('=======================================\n');

        console.log(`[IPTV-ORG] Chargement terminé. Total: ${channels.length} chaînes`);
        return channels;
    } catch (error) {
        console.error('[IPTV-ORG] Erreur lors du chargement des chaînes:', error);
        return [];
    }
}

// Endpoint pour récupérer les chaînes IPTV-org par type et catégorie
app.get('/api/channels/:type/:category', async (req, res) => {
    try {
        const { type, category } = req.params;
        const channels = config.streaming.iptv_org.channels;

        if (!channels[type] || !channels[type][category]) {
            return res.status(404).json({
                success: false,
                error: 'Catégorie non trouvée'
            });
        }

        const url = channels[type][category];
        const channelList = await loadIPTVOrgChannels(url);

        res.json({
            success: true,
            type,
            category,
            count: channelList.length,
            data: channelList
        });
    } catch (error) {
        console.error('[ERROR]', error.message);
        res.status(500).json({
            success: false,
            error: 'Erreur serveur'
        });
    }
});

// Endpoint pour récupérer toutes les chaînes IPTV-org
app.get('/api/channels', async (req, res) => {
    try {
        const allChannels = [];
        const channels = config.streaming.iptv_org.channels;

        // Parcourir tous les types (languages, categories, countries)
        for (const type of Object.keys(channels)) {
            // Parcourir toutes les catégories dans chaque type
            for (const category of Object.keys(channels[type])) {
                const url = channels[type][category];
                const channelList = await loadIPTVOrgChannels(url);
                channelList.forEach(channel => {
                    channel.source_type = type;
                    channel.source_category = category;
                });
                allChannels.push(...channelList);
            }
        }

        // Dédupliquer les chaînes basées sur leur URL
        const uniqueChannels = Array.from(new Map(
            allChannels.map(channel => [channel.url, channel])
        ).values());

        res.json({
            success: true,
            count: uniqueChannels.length,
            data: uniqueChannels
        });
    } catch (error) {
        console.error('[ERROR]', error.message);
        res.status(500).json({
            success: false,
            error: 'Erreur serveur'
        });
    }
});

// Endpoint pour obtenir la structure des catégories
app.get('/api/channels/structure', (req, res) => {
    try {
        const channels = config.streaming.iptv_org.channels;
        const structure = {};

        // Construire la structure
        for (const type of Object.keys(channels)) {
            structure[type] = Object.keys(channels[type]);
        }

        res.json({
            success: true,
            data: structure
        });
    } catch (error) {
        console.error('[ERROR]', error.message);
        res.status(500).json({
            success: false,
            error: 'Erreur serveur'
        });
    }
});

// Fonction pour charger les chaînes IPTV-org
async function loadIPTVOrgChannels(url) {
    try {
        const response = await axios.get(url);
        const m3uContent = response.data;

        // Parser le contenu M3U
        const channels = [];
        const lines = m3uContent.split('\n');
        let currentChannel = null;

        for (let line of lines) {
            line = line.trim();
            console.log('Processing line:', line);

            if (line.startsWith('#EXTINF:')) {
                const channelInfo = {};

                // Extract name
                const nameMatch = line.match(/,([^,]+)$/);
                if (nameMatch) {
                    channelInfo.name = nameMatch[1].trim();
                }

                // Extract logo
                const logoMatch = line.match(/tvg-logo="([^"]+)"/);
                if (logoMatch) {
                    channelInfo.logo = logoMatch[1];
                }

                // Extract category/group
                const groupMatch = line.match(/group-title="([^"]+)"/);
                if (groupMatch) {
                    channelInfo.category = groupMatch[1];
                }

                currentChannel = channelInfo;
            } else if (line.startsWith('http') && currentChannel) {
                currentChannel.url = line;
                channels.push(currentChannel);
                currentChannel = null;
            }
        }

        return channels;
    } catch (error) {
        console.error('Error loading IPTV-org channels:', error);
        throw error;
    }
}

// Endpoint pour récupérer toutes les chaînes IPTV-org
app.get('/api/iptv-org/channels', async (req, res) => {
    try {
        console.log('[IPTV-ORG] Début de la récupération des chaînes');
        const allChannels = [];

        // Charger les chaînes par langue
        for (const [lang, url] of Object.entries(config.streaming.iptv_org.channels.languages)) {
            try {
                const channels = await loadIPTVOrgChannels(url);
                channels.forEach(channel => {
                    channel.language = lang;
                    allChannels.push(channel);
                });
            } catch (error) {
                console.error(`Error loading ${lang} channels:`, error);
            }
        }

        // Charger les chaînes par catégorie
        for (const [category, url] of Object.entries(config.streaming.iptv_org.channels.categories)) {
            try {
                const channels = await loadIPTVOrgChannels(url);
                channels.forEach(channel => {
                    if (!channel.category) {
                        channel.category = category;
                    }
                    allChannels.push(channel);
                });
            } catch (error) {
                console.error(`Error loading ${category} channels:`, error);
            }
        }

        // Charger les chaînes par pays
        for (const [country, url] of Object.entries(config.streaming.iptv_org.channels.countries)) {
            try {
                const channels = await loadIPTVOrgChannels(url);
                channels.forEach(channel => {
                    channel.country = country;
                    allChannels.push(channel);
                });
            } catch (error) {
                console.error(`Error loading ${country} channels:`, error);
            }
        }

        // Supprimer les doublons basés sur l'URL
        const uniqueChannels = Array.from(new Map(allChannels.map(channel => [channel.url, channel])).values());

        // Filtrer les chaînes adultes
        const filteredChannels = uniqueChannels.filter(channel => {
            const adultKeywords = ['adult', 'xxx', 'sex', 'porn', '+18', '18+'];
            const name = channel.name.toLowerCase();
            return !adultKeywords.some(keyword => name.includes(keyword));
        });

        console.log(`[IPTV-ORG] ${filteredChannels.length} chaînes chargées`);

        res.json({
            success: true,
            channels: filteredChannels
        });
    } catch (error) {
        console.error('[IPTV-ORG] Error:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur lors de la récupération des chaînes IPTV-org',
            details: error.message
        });
    }
});

// Modifier l'endpoint des notifications pour ne renvoyer que l'anglais
app.get('/api/notifications', (req, res) => {
    const notifications = {
        en: "Please refresh the app regularly and clear cache for the best viewing experience"
    };

    res.json({
        success: true,
        notifications: notifications,
        timestamp: new Date().getTime()
    });
});

// Ajouter ce nouvel endpoint pour obtenir la liste des pays disponibles
app.get('/api/channels/countries', (req, res) => {
    try {
        const countries = config.streaming.iptv_org.channels.countries;
        const countriesList = Object.keys(countries).map(key => ({
            id: key,
            name: key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
            url: countries[key]
        }));

        res.json({
            success: true,
            countries: countriesList
        });
    } catch (error) {
        console.error('[COUNTRIES] Erreur:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur lors de la récupération des pays',
            details: error.message
        });
    }
});

// Servir les fichiers statiques du dossier downloads
app.use('/downloads', express.static(path.join(__dirname, 'downloads')));

// Fichiers statiques publics
app.use(express.static('public', { index: false }));
console.log('[SERVER] Fichiers statiques montés');

// Démarrage du serveur
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`[SERVER] Serveur démarré sur le port ${PORT}`);
    console.log(`[SERVER] URL du serveur IPTV: ${config.server_url}`);
});

app.get('/api/channels/default', async (req, res) => {
    try {
        // Pour l'instant, on redirige vers les chaînes arabes
        const url = config.streaming.iptv_org.channels.languages.arabic;
        const channels = await loadIPTVOrgChannels(url);

        res.json({
            success: true,
            message: `${channels.length} chaînes chargées`,
            channels: channels
        });
    } catch (error) {
        console.error('[API] Error loading channels:', error);
        res.status(500).json({
            success: false,
            message: 'Error loading channels',
            channels: []
        });
    }
});

// Renommer l'endpoint sports M3U
app.get('/api/m3u/sports', async (req, res) => {
    console.log('\n=== CHARGEMENT DES CHAÎNES SPORTIVES M3U ===');
    console.log(`[${new Date().toISOString()}] Début du chargement...`);
    try {
        const sportsChannels = [];
        const sources = config.sports_m3u.sources;
        console.log(`[SPORTS] Nombre de sources M3U: ${sources.length}`);

        for (const source of sources) {
            try {
                console.log(`\n[SPORTS] 📺 Source: ${source.name}`);


                const response = await axios.get(source.url);
                const lines = response.data.split('\n');
                console.log(`[SPORTS] 📋 Lignes à analyser: ${lines.length}`);

                let currentChannel = null;
                let sourceChannelsCount = 0;

                lines.forEach(line => {
                    line = line.trim();
                    if (line.startsWith('#EXTINF:')) {
                        const name = line.match(/,(.+)$/)?.[1]?.trim();
                        const logo = line.match(/tvg-logo="([^"]+)"/)?.[1];
                        const group = line.match(/group-title="([^"]+)"/)?.[1]?.toLowerCase();

                        const isSportsChannel = name && (
                            config.sports_m3u.categories.some(keyword =>
                                name.toLowerCase().includes(keyword.toLowerCase())
                            ) || (group && group.includes('sport'))
                        );

                        if (isSportsChannel) {
                            currentChannel = { name, logo, group };
                            console.log(`[SPORTS] ✅ Chaîne trouvée: ${name}`);
                        }
                    }
                    else if (line.startsWith('http') && currentChannel) {
                        currentChannel.url = line;
                        sportsChannels.push(currentChannel);
                        sourceChannelsCount++;
                        currentChannel = null;
                    }
                });

                console.log(`[SPORTS] ℹ️ Source ${source.name}: ${sourceChannelsCount} chaînes sportives trouvées`);

            } catch (error) {
                console.error(`[SPORTS] ❌ Erreur source ${source.name}:`, error.message);
            }
        }

        // Dédupliquer et nettoyer
        const uniqueChannels = Array.from(
            new Map(sportsChannels.map(ch => [ch.name, {
                id: ch.name.toLowerCase().replace(/[^a-z0-9]/g, ''),
                name: ch.name,
                logo: ch.logo || '',
                url: ch.url,
                category: ch.group || 'Sports',
                quality: 'HD'
            }])).values()
        );

        console.log('\n=== RÉSUMÉ DU CHARGEMENT ===');
        console.log(`Total chaînes trouvées: ${sportsChannels.length}`);
        console.log(`Chaînes uniques: ${uniqueChannels.length}`);
        console.log('=============================\n');

        res.json({
            success: true,
            channels: uniqueChannels,
            stats: {
                totalChannels: sportsChannels.length,
                uniqueChannels: uniqueChannels.length,
                processedSources: sources.length
            }
        });

    } catch (error) {
        console.error('[SPORTS] ❌ Erreur générale:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur lors du chargement des chaînes sportives'
        });
    }
});

// Fonction utilitaire pour vérifier l'accès aux M3U
async function checkM3UAccess(source) {
    try {
        console.log(`[M3U] 🔒 Vérification accès: ${source.name}`);
        const response = await axios.get(source.url, {
            timeout: 5000,
            validateStatus: (status) => status === 200
        });

        if (!response.data || !response.data.includes('#EXTM3U')) {
            throw new Error('Format M3U invalide');
        }

        console.log(`[M3U] ✅ Accès OK: ${source.name}`);
        return true;
    } catch (error) {
        console.error(`[M3U] ❌ Accès refusé: ${source.name} - ${error.message}`);
        return false;
    }
}

// Modifier l'endpoint sports pour inclure l'authentification
app.get('/api/m3u/sports', async (req, res) => {
    console.log('\n=== CHARGEMENT DES CHAÎNES SPORTIVES M3U ===');
    console.log(`[${new Date().toISOString()}] Début du chargement...`);

    try {
        const sportsChannels = [];
        const sources = config.sports_m3u.sources;
        console.log(`[SPORTS] Nombre de sources M3U: ${sources.length}`);

        // Vérifier l'accès aux sources M3U
        const accessResults = await Promise.all(
            sources.map(source => checkM3UAccess(source))
        );

        const validSources = sources.filter((_, index) => accessResults[index]);
        console.log(`[SPORTS] Sources valides: ${validSources.length}/${sources.length}`);

        if (validSources.length === 0) {
            throw new Error('Aucune source M3U accessible');
        }

        // Continuer avec les sources valides uniquement
        for (const source of validSources) {
            try {
                console.log(`\n[SPORTS] 📺 Chargement source: ${source.name}`);
                const response = await axios.get(source.url);
                const lines = response.data.split('\n');
                console.log(`[SPORTS] 📋 Lignes à analyser: ${lines.length}`);

                let currentChannel = null;
                let sourceChannelsCount = 0;

                lines.forEach(line => {
                    line = line.trim();
                    if (line.startsWith('#EXTINF:')) {
                        const name = line.match(/,(.+)$/)?.[1]?.trim();
                        const logo = line.match(/tvg-logo="([^"]+)"/)?.[1];
                        const group = line.match(/group-title="([^"]+)"/)?.[1]?.toLowerCase();

                        const isSportsChannel = name && (
                            config.sports_m3u.categories.some(keyword =>
                                name.toLowerCase().includes(keyword.toLowerCase())
                            ) || (group && group.includes('sport'))
                        );

                        if (isSportsChannel) {
                            currentChannel = { name, logo, group };
                            console.log(`[SPORTS] ✅ Chaîne trouvée: ${name}`);
                        }
                    }
                    else if (line.startsWith('http') && currentChannel) {
                        currentChannel.url = line;
                        sportsChannels.push(currentChannel);
                        sourceChannelsCount++;
                        currentChannel = null;
                    }
                });

                console.log(`[SPORTS] ℹ️ Source ${source.name}: ${sourceChannelsCount} chaînes sportives trouvées`);

            } catch (error) {
                console.error(`[SPORTS] ❌ Erreur source ${source.name}:`, error.message);
            }
        }

        // Dédupliquer et nettoyer
        const uniqueChannels = Array.from(
            new Map(sportsChannels.map(ch => [ch.name, {
                id: ch.name.toLowerCase().replace(/[^a-z0-9]/g, ''),
                name: ch.name,
                logo: ch.logo || '',
                url: ch.url,
                category: ch.group || 'Sports',
                quality: 'HD'
            }])).values()
        );

        console.log('\n=== RÉSUMÉ DU CHARGEMENT ===');
        console.log(`Total chaînes trouvées: ${sportsChannels.length}`);
        console.log(`Chaînes uniques: ${uniqueChannels.length}`);
        console.log('=============================\n');

        res.json({
            success: true,
            channels: uniqueChannels,
            stats: {
                totalChannels: sportsChannels.length,
                uniqueChannels: uniqueChannels.length,
                processedSources: sources.length
            }
        });

    } catch (error) {
        console.error('[SPORTS] ❌ Erreur générale:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur lors du chargement des chaînes sportives',
            details: error.message
        });
    }
});