<script>
import { onMount } from 'svelte';
import { setDiscordContext } from '../../lib/aerolux/discord';
import NewProjectModal from '../modals/NewProjectModal.svelte';
import RecentProjectsList from '../home/RecentProjectsList.svelte';
import { router, clearIntent } from '../../stores/router.svelte.js';
import { openProject, loadRecentProject } from '../../stores/projects.svelte.js';
import { hapticMajorAction } from '../../lib/aerolux/haptics';

let { onNewProject, onOpenProject, onOpenRecent } = $props();
let newProjectModalOpen = $state(false);

const tips = [
    // velocity-specific
    'Velocity: You can hold Shift while dragging a stop to snap it to the nearest 5%.',
    'Velocity: The HSL algorithm on "longest" direction can produce full rainbow gradients with just two stops.',
    'Velocity: You can press R to randomise your gradient instantly.',
    'Velocity: You can export your gradient then inject it into a MIDI file without losing any timing data.',
    'Velocity: The LAB algorithm (Perceptual) is the most colour-accurate. Try it on gradients with large hue jumps!',
    'Velocity: You can drag a .txt gradient file directly onto the import zone.',
    'Velocity: The Python batch script can generate multiple variations in one run.',
    'Velocity: Tint with white at 30–40% strength turns any deep colour into its pastel equivalent.',
    'Velocity: The Bell envelope brightens the middle of the gradient. Great for a glowing effect.',

    // kinetic-specific
    'Kinetic: Shift + Drag to box-select multiple nodes at once.',
    'Kinetic: Imported clips function the same way as any other generator node, so you can losslessly edit them!',
    'Kinetic: The Stage lets you place any device anywhere.',
    'Kinetic: Generator nodes support saved gradients from Velocity.',
    'Kinetic: You can hold Shift on the Stage to enable free placement.',

    // general
    'Airbot works entirely on-device. Nothing you generate ever leaves your machine.',    
    'Hold Alt/Option to access more information or settings. Try it out here!',
    'Aerolux was initially made to quickly make a new gradient pack for the airborneyt palette.',
    'Kinetic was designed way before Velocity. Back in 2025! It started as a JUCE project.',
];
const tip = tips[Math.floor(Math.random() * tips.length)];

const eggs = [
    '"Out of all the numbers from 0 to 50... I got a score of 13."',
    'Lightshows bro, lightshows!',
    'choqam olkowk... impressed... 🫪',
    'this is FIRE!!! extinguish it!!!',
    'on the lights, sure, on the song HELL NO.',
    'The world hasn\'t ended yet.',
    'Keep making great stuff.',
    'Brought to you by TheRealAirborneOfficial',
]
const egg = eggs[Math.floor(Math.random() * eggs.length)];

const KONAMI = ['ArrowUp','ArrowUp','ArrowDown','ArrowDown','ArrowLeft','ArrowRight','ArrowLeft','ArrowRight','b','a'];
let konamiIndex = 0;
let showEgg = $state(false);

onMount(() => {
    setDiscordContext('home');

    const handler = (e) => {
        if (e.key === KONAMI[konamiIndex]) {
            konamiIndex++;
            if (konamiIndex === KONAMI.length) {
                showEgg = true;
                konamiIndex = 0;
                setTimeout(() => showEgg = false, 4000);
            }
        } else {
            konamiIndex = 0;
        }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
});

$effect(() => {
    if (router.intent === 'newProject') {
        newProjectModalOpen = true;
        clearIntent();
    } else if (router.intent === 'openProject') {
        openProject();
        clearIntent();
    }
});

async function handleOpenRecent(recent) {
    // navigation to the correct editor now happens inside
    // loadProjectFromPath (projects.svelte.js) itself, so both this
    // and file → open from the native menu behave identically.
    hapticMajorAction();
    await loadRecentProject(recent.path);
}

function handleNewProject() {
    hapticMajorAction();
    newProjectModalOpen = true;
}

function handleOpenProject() {
    hapticMajorAction();
    openProject();
}

</script>

<div class="al-home">

    <!-- header -->
    <div class="al-home-header">
        <div class="al-home-logo">
            <svg width="50%" height="50%" viewBox="0 0 5002 589" version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xml:space="preserve" xmlns:serif="http://www.serif.com/" style="fill-rule:evenodd;clip-rule:evenodd;stroke-linejoin:round;stroke-miterlimit:2;">
                <g transform="matrix(1,0,0,1,-51.081456,-786.811489)">
                    <g transform="matrix(1.443805,0,0,1.443805,-560.802992,-525.708551)">
                        <path d="M718.429,1070.017C717.789,1069.046 716.704,1068.461 715.541,1068.46C714.378,1068.459 713.292,1069.041 712.65,1070.011C699.724,1089.537 646.941,1169.268 624.973,1202.451C624.067,1203.821 624.248,1205.639 625.406,1206.804C626.565,1207.968 628.381,1208.159 629.756,1207.261C651.31,1193.215 691.879,1169.016 715.544,1169.016C739.177,1169.016 779.456,1193.15 800.908,1207.204C802.281,1208.106 804.099,1207.92 805.26,1206.757C806.421,1205.595 806.605,1203.776 805.701,1202.405C783.81,1169.196 731.301,1089.543 718.429,1070.017ZM554.552,1309C514.579,1321.599 551.663,1309.967 438.124,1309.056C436.538,1309.038 435.167,1307.945 434.796,1306.403C434.425,1304.861 435.15,1303.264 436.554,1302.527C605.762,1212.243 653.081,1001.439 658.488,974.584C658.792,972.943 660.223,971.753 661.892,971.753C677.616,971.752 753.473,971.752 769.196,971.752C770.865,971.752 772.297,972.942 772.601,974.583C778.01,1001.443 825.36,1212.333 994.518,1302.536C995.919,1303.27 996.642,1304.863 996.272,1306.4C995.902,1307.938 994.535,1309.028 992.953,1309.046C879.762,1309.97 916.504,1321.597 876.536,1309C827.912,1293.675 769.208,1217.049 715.544,1217.049C661.88,1217.049 603.176,1293.675 554.552,1309Z" style="fill-rule:nonzero;fill:var(--color-text);"/>
                        <g transform="matrix(1,0,0,1,131.855144,0)">
                            <path d="M1210.051,1308.922C1186.908,1309.384 962.214,1313.868 920.719,1310.371C917.009,1310.059 866.311,1286.197 825.463,1248.852C781.258,1208.437 779.662,1199.733 754.879,1160.251C753.971,1158.804 754.254,1156.911 755.546,1155.793C756.837,1154.675 758.751,1154.666 760.053,1155.771C791.064,1181.72 825.074,1207.668 855.134,1233.616C856.149,1234.497 857.582,1234.711 858.81,1234.164C860.038,1233.618 860.84,1232.411 860.865,1231.067C863.106,1198.779 873.278,1099.837 732.212,1005.024C724.607,999.912 716.746,995.184 708.834,990.561C696.408,983.3 692.23,981.903 684.857,978.436C683.39,977.748 682.596,976.133 682.947,974.551C683.298,972.968 684.701,971.841 686.322,971.838C767.978,971.702 1174.178,971.024 1208.33,970.967C1209.717,970.964 1210.972,971.79 1211.519,973.066C1216.001,983.526 1235.938,1030.053 1242.455,1045.261C1242.913,1046.331 1242.804,1047.56 1242.163,1048.531C1241.522,1049.503 1240.436,1050.088 1239.272,1050.088C1202.546,1050.088 984.733,1050.088 954.307,1050.088C953.377,1050.088 952.487,1050.462 951.836,1051.125C951.184,1051.789 950.827,1052.686 950.845,1053.616C951.018,1062.904 951.486,1087.949 951.657,1097.09C951.692,1098.977 953.232,1100.488 955.119,1100.488C981.826,1100.488 1156.895,1100.488 1156.895,1100.488L1156.895,1179.688C1156.895,1179.688 981.234,1179.688 954.242,1179.688C952.329,1179.688 950.779,1181.238 950.779,1183.151C950.779,1192.365 950.779,1217.404 950.779,1226.621C950.779,1227.541 951.144,1228.422 951.794,1229.071C952.444,1229.721 953.326,1230.085 954.245,1230.085C984.049,1230.054 1196.808,1229.84 1231.612,1229.805C1232.726,1229.804 1233.772,1230.338 1234.424,1231.242C1235.075,1232.145 1235.253,1233.306 1234.901,1234.363C1229.287,1251.207 1210.051,1308.922 1210.051,1308.922Z" style="fill-rule:nonzero;fill:var(--color-text);"/>
                        </g>
                        <g transform="matrix(1,0,0,1,50.396016,1.371354)">
                            <path d="M1684.775,971.176C1684.775,971.176 1684.775,971.176 1684.775,971.176C1702.439,971.176 1719.095,974.536 1734.743,981.256C1750.391,987.976 1764.023,997.144 1775.639,1008.76C1787.255,1020.376 1796.423,1033.96 1803.143,1049.512C1809.863,1065.064 1813.223,1081.768 1813.223,1099.624C1813.223,1113.64 1811.063,1127.08 1806.743,1139.944C1802.423,1152.808 1796.375,1164.568 1788.599,1175.224C1780.823,1185.88 1771.559,1195.144 1760.807,1203.016C1751.518,1209.817 1741.513,1218.068 1730.791,1222.911C1729.704,1223.366 1728.925,1224.344 1728.725,1225.505C1728.525,1226.666 1728.933,1227.849 1729.806,1228.64C1743.305,1240.234 1790.607,1276.404 1880.764,1302.193C1882.423,1302.667 1883.478,1304.291 1883.238,1305.999C1882.999,1307.707 1881.537,1308.977 1879.813,1308.977C1818.399,1308.922 1688.745,1308.739 1671.669,1308.715C1670.48,1308.713 1669.375,1308.101 1668.742,1307.094C1661.131,1295.87 1611.039,1230.143 1481.459,1228.107C1479.787,1228.081 1478.335,1229.255 1478.01,1230.896C1475.534,1243.406 1465.57,1293.765 1463.109,1306.209C1462.788,1307.831 1461.365,1309 1459.711,1309C1442.556,1309 1352.897,1309 1330.872,1309C1329.747,1309 1328.691,1308.453 1328.042,1307.532C1327.393,1306.612 1327.232,1305.434 1327.611,1304.374C1339.166,1270.842 1406.148,1063.911 1331.307,976.918C1330.412,975.9 1330.196,974.453 1330.754,973.218C1331.312,971.983 1332.542,971.189 1333.898,971.189C1420.234,971.176 1684.732,971.176 1684.775,971.176ZM1482.03,1063.336C1481.112,1063.336 1480.231,1063.701 1479.582,1064.35C1478.932,1065 1478.567,1065.881 1478.567,1066.799C1478.567,1075.398 1478.567,1097.563 1478.567,1104.94C1478.567,1106.398 1479.481,1107.7 1480.851,1108.196C1499.167,1114.828 1621.751,1159.214 1633.697,1163.54C1634.158,1163.707 1634.653,1163.764 1635.14,1163.706C1640.511,1160.914 1685.74,1132.304 1696.007,1113.592C1704.957,1097.282 1691.526,1063.336 1662.887,1063.336C1662.887,1063.336 1507.342,1063.336 1482.03,1063.336Z" style="fill-rule:nonzero;fill:var(--color-text);"/>
                        </g>
                        <g transform="matrix(1,0,0,1,59.814241,1.371354)">
                            <path d="M2242.343,1141.384C2242.343,1135.889 2242.343,1100.962 2208.287,1081.732C2171.312,1060.853 2105.987,1059.746 2096.903,1059.592C2081.715,1059.592 1952.904,1056.392 1951.463,1141.384C1951.952,1156.057 1973.491,1228.484 2114.031,1222.854C2215.631,1218.784 2241.602,1175.132 2242.343,1141.384ZM2096.903,1223.176C2097.029,1223.176 2097.221,1223.212 2097.335,1223.123C2097.491,1223.002 2096.707,1222.788 2096.623,1222.989C2096.556,1223.148 2096.806,1223.176 2096.903,1223.176ZM2096.903,968.008C2208.62,965.92 2284.448,996.251 2306.873,1014.776C2315.284,1021.724 2358.141,1057.125 2357.543,1141.384C2357.633,1153.703 2358.253,1238.649 2288.982,1279.272C2224.877,1316.864 2112.523,1314.764 2096.903,1314.472C2045.736,1315.437 1897.704,1321.574 1847.673,1202.74C1840.175,1184.931 1819.075,1089.833 1877.949,1023.28C1902.865,995.114 1994.065,966.068 2096.903,968.008Z" style="fill-rule:nonzero;fill:var(--color-text);"/>
                        </g>
                        <g transform="matrix(1,0,0,1,40.977792,1.371354)">
                            <path d="M2832.888,1237.404C2834.334,1237.404 2835.628,1238.303 2836.133,1239.657C2840.018,1248.377 2856.397,1280.249 2892.483,1302.598C2893.799,1303.404 2894.419,1304.987 2894,1306.473C2893.581,1307.958 2892.225,1308.984 2890.682,1308.984C2813.974,1309 2427.473,1309 2341.635,1309C2339.969,1309 2338.54,1307.815 2338.232,1306.178C2337.923,1304.542 2338.823,1302.918 2340.374,1302.311C2359.004,1295.282 2384.482,1285.041 2405.211,1247.727C2445.325,1175.517 2431.9,1092.404 2416.744,1058.039C2390.08,997.581 2368.43,991.418 2348.057,977.465C2346.825,976.597 2346.297,975.032 2346.752,973.595C2347.207,972.159 2348.54,971.183 2350.047,971.183C2385.909,971.176 2504.756,971.176 2526.592,971.176C2528.505,971.176 2530.055,972.726 2530.055,974.639L2530.055,1233.941C2530.055,1235.854 2531.606,1237.404 2533.518,1237.404L2832.888,1237.404Z" style="fill-rule:nonzero;fill:var(--color-text);"/>
                        </g>
                        <g transform="matrix(1,0,0,1,59.814241,1.371354)">
                            <path d="M3286.336,971.752C3287.255,971.752 3288.136,972.117 3288.785,972.766C3289.434,973.416 3289.799,974.297 3289.799,975.215C3289.799,998.277 3289.799,1128.712 3289.799,1128.712C3289.886,1140.009 3290.463,1215.005 3241.775,1261.516C3220.552,1281.79 3177.697,1298.635 3178.199,1298.344C3174.646,1298.909 3133.726,1313.137 3073.223,1315.048L3045.287,1315.048C2930.026,1311.408 2828.711,1272.76 2828.711,1128.712L2828.711,975.215C2828.711,974.297 2829.076,973.416 2829.726,972.766C2830.375,972.117 2831.256,971.752 2832.174,971.752C2849.153,971.752 2923.469,971.752 2940.448,971.752C2941.367,971.752 2942.248,972.117 2942.897,972.766C2943.546,973.416 2943.911,974.297 2943.911,975.215C2943.911,998.815 2943.911,1135.048 2943.911,1135.048C2945.365,1219.388 3047.823,1222.015 3059.399,1222.312C3127.82,1220.511 3173.74,1184.869 3174.599,1135.048C3174.599,1135.048 3174.599,998.815 3174.599,975.215C3174.599,974.297 3174.964,973.416 3175.614,972.766C3176.263,972.117 3177.144,971.752 3178.062,971.752C3195.041,971.752 3269.357,971.752 3286.336,971.752Z" style="fill-rule:nonzero;fill:var(--color-text);"/>
                        </g>
                        <g transform="matrix(1,0,0,1,56.046951,1.371354)">
                            <path d="M3480.102,971.464C3480.888,971.464 3481.65,971.731 3482.264,972.222C3492.393,980.384 3580.808,1052.444 3593.972,1091.575C3605.144,1124.783 3588.586,1205.952 3581.508,1237.122C3581.156,1238.641 3581.863,1240.207 3583.234,1240.948C3584.605,1241.69 3586.303,1241.424 3587.381,1240.298C3605.837,1221.095 3647.398,1179.203 3654.443,1183.807C3654.679,1183.966 3654.934,1184.095 3655.203,1184.19C3691.476,1197.415 3784.608,1280.208 3810.357,1303.485C3811.425,1304.445 3811.789,1305.965 3811.272,1307.304C3810.754,1308.643 3809.463,1309.524 3808.027,1309.517C3775.002,1309.353 3661.936,1308.777 3650.209,1308.717C3649.565,1308.714 3648.934,1308.531 3648.388,1308.189C3640.76,1303.413 3583.216,1267.382 3573.222,1261.124C3572.293,1260.543 3571.143,1260.435 3570.122,1260.835C3556.129,1266.313 3456.164,1305.447 3447.402,1308.877C3446.996,1309.036 3446.565,1309.117 3446.13,1309.116C3436.423,1309.09 3321.6,1308.794 3249.451,1308.726C3247.724,1308.725 3246.261,1307.452 3246.023,1305.741C3245.784,1304.031 3246.842,1302.406 3248.503,1301.933C3465.08,1240.615 3488.807,1172.349 3488.807,1139.944C3488.807,1107.721 3457.531,1030.714 3338.432,978.09C3336.936,977.431 3336.107,975.814 3336.444,974.215C3336.78,972.615 3338.191,971.471 3339.826,971.471C3404.064,971.464 3470.38,971.464 3480.102,971.464Z" style="fill-rule:nonzero;fill:var(--color-text);"/>
                        </g>
                        <g transform="matrix(0.363922,-0.112545,0.112545,0.363922,3583.720873,942.419209)">
                            <path d="M606.413,96.587C623.91,114.083 501,203.095 501,352C501,379.596 478.596,402 451,402L351,402L301,352L301,252C301,224.404 323.404,202 351,202C499.905,202 588.917,79.09 606.413,96.587Z" style="fill-rule:nonzero;fill:var(--color-text);"/>
                        </g>
                        <g transform="matrix(-0.363922,0.112545,-0.112545,-0.363922,3885.8752,1181.31073)">
                            <path d="M606.413,96.587C623.91,114.083 501,203.095 501,352C501,379.596 478.596,402 451,402L351,402L301,352L301,252C301,224.404 323.404,202 351,202C499.905,202 588.917,79.09 606.413,96.587Z" style="fill-rule:nonzero;fill:var(--color-text);"/>
                        </g>
                        <g transform="matrix(0.112545,0.363922,-0.363922,0.112545,3854.243797,910.787806)">
                            <path d="M606.413,96.587C623.91,114.083 501,203.095 501,352C501,379.596 478.596,402 451,402L351,402L301,352L301,252C301,224.404 323.404,202 351,202C499.905,202 588.917,79.09 606.413,96.587Z" style="fill-rule:nonzero;fill:var(--color-text);"/>
                        </g>
                        <g transform="matrix(-0.112545,-0.363922,0.363922,-0.112545,3615.352276,1212.942132)">
                            <path d="M606.413,96.587C623.91,114.083 501,203.095 501,352C501,379.596 478.596,402 451,402L351,402L301,352L301,252C301,224.404 323.404,202 351,202C499.905,202 588.917,79.09 606.413,96.587Z" style="fill-rule:nonzero;fill:var(--color-text);"/>
                        </g>
                    </g>
                </g>
            </svg>
        </div>
        <p class="al-home-tagline">Launchpad Light Effect Design Suite</p>
    </div>

    <!-- easter egg -->
    {#if showEgg}
        <div class="al-tip-card" style="border-color:var(--color-success-border);background:var(--color-success-subtle);margin-bottom:var(--space-4);animation:al-slide-up 0.3s ease both">
            <img src="/airborneyt.svg" alt="Made by Airborne" width="25" height="25" />
            <span class="al-tip-label" style="color:var(--color-success)">
                {egg}
            </span>
        </div>
    {/if}

    <!-- tip -->
    <div class="al-tip-card">
        <span class="al-tip-icon">💡</span>
        <p><span class="al-tip-label">Did you know? </span>{tip}</p>
    </div>

    <!-- primary actions -->
    <div class="al-home-actions">
        <div class="al-home-card al-home-card-primary" onclick={handleNewProject}>
            <span class="al-home-card-icon">✦</span>
            <div class="al-home-card-title">New project</div>
            <p class="al-home-card-desc">
                Start from a blank canvas.
            </p>
        </div>

        <div class="al-home-card" onclick={handleOpenProject}>
            <span class="al-home-card-icon">📂</span>
            <div class="al-home-card-title">Open project</div>
            <p class="al-home-card-desc">
                Load an existing .alx project file from your filesystem.
            </p>
        </div>
    </div>

    <!-- recently opened -->
    <p class="al-home-section-title">Recently opened</p>
    <RecentProjectsList onOpenRecent={handleOpenRecent} />

    <!-- version stamp -->
    <p class="al-dim" style="text-align:center;padding-top:var(--space-4)">
        Aerolux 2.0.0-alpha.5 · by Airborne
    </p>

    <NewProjectModal bind:open={newProjectModalOpen} />

</div>