const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

const PTERO_DOMAIN = process.env.PTERODACTYL_DOMAIN;
const PTERO_APP_KEY = process.env.PTERODACTYL_APP_API_KEY; // ptla_ key for admin actions

const pteroAPI = axios.create({
    baseURL: `${PTERO_DOMAIN}/api/application`,
    headers: {
        'Authorization': `Bearer ${PTERO_APP_KEY}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
    }
});

const DEFAULT_EGG_ID = 15;
const DEFAULT_LOCATION_ID = 1;
const DEFAULT_DOCKER_IMAGE = 'ghcr.io/pterodactyl/yolks:nodejs_18';
const DEFAULT_MAIN_SCRIPT = "index.js";

const RESOURCE_MAP = {
    1000:  { ram: 1024, cpu: 40,  disk: 5120,  name_suffix: "1GB RAM" },
    2000:  { ram: 2048, cpu: 60,  disk: 10240, name_suffix: "2GB RAM" },
    3000:  { ram: 3072, cpu: 80,  disk: 15360, name_suffix: "3GB RAM" },
    4000:  { ram: 4096, cpu: 100, disk: 20480, name_suffix: "4GB RAM" },
    5000:  { ram: 5120, cpu: 120, disk: 25600, name_suffix: "5GB RAM" },
    6000:  { ram: 6144, cpu: 140, disk: 30720, name_suffix: "6GB RAM" },
    7000:  { ram: 7168, cpu: 160, disk: 35840, name_suffix: "7GB RAM" },
    8000:  { ram: 8192, cpu: 180, disk: 40960, name_suffix: "8GB RAM" },
    8500:  { ram: 9216, cpu: 200, disk: 46080, name_suffix: "9GB RAM" },
    9000:  { ram: 10240,cpu: 220, disk: 51200, name_suffix: "10GB RAM"},
    10000: { ram: 0,    cpu: 0,   disk: 0,     name_suffix: "UNLI RAM/CPU" },
    12000: { ram: 0,    cpu: 0,   disk: 0,     name_suffix: "Reseller Panel", is_reseller: true },
    15000: { ram: 0,    cpu: 0,   disk: 0,     name_suffix: "Admin Panel", is_admin: true },
};


const findUserByEmail = async (email) => {
    try {
        const response = await pteroAPI.get(`/users?filter[email]=${encodeURIComponent(email)}`);
        if (response.data.data && response.data.data.length > 0) {
            return response.data.data[0].attributes;
        }
        return null;
    } catch (error) {
        if (error.response && error.response.status === 404) return null;
        console.error('Error finding Pterodactyl user:', error.response ? error.response.data : error.message);
        throw error;
    }
};

const createPterodactylUser = async (email, firstName, lastName, externalId) => {
    const password = uuidv4();
    const usernameSuffix = Math.floor(Math.random() * 10000);
    const username = (email.split('@')[0] + usernameSuffix).substring(0, 190); // Max length for username can be an issue

    try {
        const response = await pteroAPI.post('/users', {
            email: email,
            username: username,
            first_name: firstName,
            last_name: lastName,
            password: password,
            root_admin: false,
            external_id: externalId
        });
        return { ...response.data.attributes, plainPassword: password };
    } catch (error) {
        console.error('Error creating Pterodactyl user:', error.response ? error.response.data.errors : error.message);
        throw error;
    }
};

const createPterodactylServer = async (userId, serverName, resources) => {
    const mainScript = resources.main_script || DEFAULT_MAIN_SCRIPT;

    const environmentVariables = {
        "SERVER_JARFILE": mainScript,
        "USER_UPLOAD": "0",
        "AUTO_UPDATE": "0",
        "BOT_FILENAME": mainScript,
        "CMD_RUN": `node ${mainScript}`
    };

    const startupCommand = `node ${mainScript}`;

    const serverData = {
        name: serverName,
        user: userId,
        egg: resources.egg || DEFAULT_EGG_ID,
        docker_image: resources.image || DEFAULT_DOCKER_IMAGE,
        startup: startupCommand,
        environment: environmentVariables,
        limits: {
            memory: resources.ram,
            swap: resources.swap !== undefined ? resources.swap : 0,
            disk: resources.disk,
            io: resources.io || 500,
            cpu: resources.cpu
        },
        feature_limits: {
            databases: resources.databases !== undefined ? resources.databases : 1,
            allocations: resources.allocations !== undefined ? resources.allocations : 1,
            backups: resources.backups !== undefined ? resources.backups : 1
        },
        deploy: {
            locations: [resources.location_id || DEFAULT_LOCATION_ID],
            dedicated_ip: false,
            port_range: []
        },
        start_on_completion: true,
        // oom_disabled: false, // Consider if you need to change OOM killer behavior
        // allocation_additional: [], // If you need more than the default allocation
    };

    try {
        const response = await pteroAPI.post('/servers', serverData);
        return response.data.attributes;
    } catch (error) {
        console.error('Error creating Pterodactyl server:', error.response ? JSON.stringify(error.response.data.errors, null, 2) : error.message);
        if (error.response && error.response.data && error.response.data.errors) {
            error.response.data.errors.forEach(err => console.error(`Detail: ${err.detail} (Source: ${err.meta ? err.meta.source_field : 'N/A'})`));
        }
        throw error;
    }
};

module.exports = {
    findUserByEmail,
    createPterodactylUser,
    createPterodactylServer,
    RESOURCE_MAP
};