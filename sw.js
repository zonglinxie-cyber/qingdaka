'use strict';

// 构建会替换这四组标记，自动绑定内容 hash。
var VERSION = /* BUILD_VERSION_START */ "coach-30294a063bc8f8c2b9da" /* BUILD_VERSION_END */;
var CORE = /* BUILD_PRECACHE_START */ [
  "./app.js",
  "./assets/exercise-guides/0257-poster.png",
  "./assets/exercise-guides/0257.gif",
  "./assets/exercise-guides/0276-poster.png",
  "./assets/exercise-guides/0276.gif",
  "./assets/exercise-guides/0291-poster.png",
  "./assets/exercise-guides/0291.gif",
  "./assets/exercise-guides/0292-poster.png",
  "./assets/exercise-guides/0292.gif",
  "./assets/exercise-guides/0404-poster.png",
  "./assets/exercise-guides/0404.gif",
  "./assets/exercise-guides/0576-poster.png",
  "./assets/exercise-guides/0576.gif",
  "./assets/exercise-guides/0579-poster.png",
  "./assets/exercise-guides/0579.gif",
  "./assets/exercise-guides/0588-poster.png",
  "./assets/exercise-guides/0588.gif",
  "./assets/exercise-guides/0599-poster.png",
  "./assets/exercise-guides/0599.gif",
  "./assets/exercise-guides/0603-poster.png",
  "./assets/exercise-guides/0603.gif",
  "./assets/exercise-guides/0643-poster.png",
  "./assets/exercise-guides/0643.gif",
  "./assets/exercise-guides/0659-poster.png",
  "./assets/exercise-guides/0659.gif",
  "./assets/exercise-guides/0669-poster.png",
  "./assets/exercise-guides/0669.gif",
  "./assets/exercise-guides/0710-poster.png",
  "./assets/exercise-guides/0710.gif",
  "./assets/exercise-guides/0794-poster.png",
  "./assets/exercise-guides/0794.gif",
  "./assets/exercise-guides/1167-poster.png",
  "./assets/exercise-guides/1167.gif",
  "./assets/exercise-guides/1365-poster.png",
  "./assets/exercise-guides/1365.gif",
  "./assets/exercise-guides/1368-poster.png",
  "./assets/exercise-guides/1368.gif",
  "./assets/exercise-guides/1373-poster.png",
  "./assets/exercise-guides/1373.gif",
  "./assets/exercise-guides/1377-poster.png",
  "./assets/exercise-guides/1377.gif",
  "./assets/exercise-guides/1403-poster.png",
  "./assets/exercise-guides/1403.gif",
  "./assets/exercise-guides/1424-poster.png",
  "./assets/exercise-guides/1424.gif",
  "./assets/exercise-guides/1428-poster.png",
  "./assets/exercise-guides/1428.gif",
  "./assets/exercise-guides/1459-poster.png",
  "./assets/exercise-guides/1459.gif",
  "./assets/exercise-guides/1576-poster.png",
  "./assets/exercise-guides/1576.gif",
  "./assets/exercise-guides/1677-poster.png",
  "./assets/exercise-guides/1677.gif",
  "./assets/exercise-guides/2133-poster.png",
  "./assets/exercise-guides/2133.gif",
  "./assets/exercise-guides/2287-poster.png",
  "./assets/exercise-guides/2287.gif",
  "./assets/exercise-guides/3013-poster.png",
  "./assets/exercise-guides/3013.gif",
  "./assets/exercise-guides/3221-poster.png",
  "./assets/exercise-guides/3221.gif",
  "./assets/exercise-guides/bird-dog-poster.png",
  "./assets/exercise-guides/bird-dog.gif",
  "./assets/exercise-guides/generated/wall-plank-anatomy.png",
  "./assets/voice/countdown-3.m4a",
  "./assets/voice/countdown-start.m4a",
  "./assets/voice/encourage-1.m4a",
  "./assets/voice/encourage-2.m4a",
  "./assets/voice/encourage-3.m4a",
  "./assets/voice/encourage-4.m4a",
  "./assets/voice/encourage-5.m4a",
  "./assets/voice/finish-done.m4a",
  "./assets/voice/finish-stretch.m4a",
  "./assets/voice/stretch-0643.m4a",
  "./assets/voice/stretch-0669.m4a",
  "./assets/voice/stretch-0794.m4a",
  "./assets/voice/stretch-1365.m4a",
  "./assets/voice/stretch-1377.m4a",
  "./assets/voice/stretch-1403.m4a",
  "./assets/voice/stretch-1424.m4a",
  "./assets/voice/stretch-1576.m4a",
  "./assets/voice/switch-side.m4a",
  "./assets/voice/warmup-0257.m4a",
  "./assets/voice/warmup-1167.m4a",
  "./assets/voice/warmup-1368.m4a",
  "./assets/voice/warmup-1428.m4a",
  "./assets/voice/warmup-3221.m4a",
  "./assets/voice/work-0276.m4a",
  "./assets/voice/work-0291.m4a",
  "./assets/voice/work-0292.m4a",
  "./assets/voice/work-0404.m4a",
  "./assets/voice/work-0576.m4a",
  "./assets/voice/work-0579.m4a",
  "./assets/voice/work-0588.m4a",
  "./assets/voice/work-0599.m4a",
  "./assets/voice/work-0603.m4a",
  "./assets/voice/work-0659.m4a",
  "./assets/voice/work-0710.m4a",
  "./assets/voice/work-1373.m4a",
  "./assets/voice/work-1459.m4a",
  "./assets/voice/work-1677.m4a",
  "./assets/voice/work-2287.m4a",
  "./assets/voice/work-3013.m4a",
  "./content.js",
  "./icons/apple-touch-icon-180.png",
  "./icons/icon-192.png",
  "./icons/icon-512-maskable.png",
  "./icons/icon-512.png",
  "./index.html",
  "./manifest.webmanifest",
  "./session.js",
  "./styles.css"
] /* BUILD_PRECACHE_END */;
var COMPLETE_RELEASE = /* BUILD_COMPLETE_START */ true /* BUILD_COMPLETE_END */;
var RELEASE_HASHES = /* BUILD_HASHES_START */ {
  "./app.js": "d7bdeb3847132a102f829d3ea38bb62208867d342e7f94cee5a20afd7c7e9cd6",
  "./assets/exercise-guides/0257-poster.png": "1f1ffe6a159e58f71a4cd588dd12b476d65777ece75f7accf3c441273302dafa",
  "./assets/exercise-guides/0257.gif": "c16f80d17e0755607992ad4f7f8702fb590f778683eb082d22bdc36985329055",
  "./assets/exercise-guides/0276-poster.png": "2aea608c56fc02135862a14b4614674c8fbb27419e0c39212ff5bf9135267b68",
  "./assets/exercise-guides/0276.gif": "e928dd260751357f9048c069a64b3076d6e53e4011b4ac6cc719e9da676d2b96",
  "./assets/exercise-guides/0291-poster.png": "a66b6ed3185734d2a82e8fc2e972917ea4962142221440d720d13ab140ab9d38",
  "./assets/exercise-guides/0291.gif": "b66a750d54c81cfbb67564ccb2685e720b21d203fde5deca84679b38d41c69e9",
  "./assets/exercise-guides/0292-poster.png": "e25ef19a7e62ab905709e6c2b409402ab99ec32257a55ef8cb19e954775c0f64",
  "./assets/exercise-guides/0292.gif": "10e9b5dd62904ce1fb5ec75dd4eeb76623f4beff3ff981164f340c559535d767",
  "./assets/exercise-guides/0404-poster.png": "babdd514be4eada33c3e5e96069f3a8f64c29a85bc80c25cce5b7dce2f01d251",
  "./assets/exercise-guides/0404.gif": "23934d260bcbce0ffb52980b02697a309cfbd3daed001e908e2fe9287ce73bc2",
  "./assets/exercise-guides/0576-poster.png": "891800c1deb44447d4e97356b3af4b36c9a47b7b9f28373a8781fddcf7069c10",
  "./assets/exercise-guides/0576.gif": "27a1b1026deed1ea93ef969c63deaa3ee67c1aa62d6ea9400f5663da9ed2ea1f",
  "./assets/exercise-guides/0579-poster.png": "e4f6d3ed4b333785112ff275e5063fb70cec652e93da1e1ac26d7bd4e07fd2d8",
  "./assets/exercise-guides/0579.gif": "9df056a0b249fef3a68ca9761f372bad67899369b9064728c658def57210dbf2",
  "./assets/exercise-guides/0588-poster.png": "1315fc43f6b9593d4bd578d345d1c33805a3d7d051092149fc585bda78f7425d",
  "./assets/exercise-guides/0588.gif": "f0e41b38b468e1492f41b7a23e6d71f92fffac489125c00d2390f9421df0f105",
  "./assets/exercise-guides/0599-poster.png": "ca26573f587d36a5c7047aa46ce75d47394823f74a246ba0599250a2fff3d189",
  "./assets/exercise-guides/0599.gif": "4af2536a2fbb7fb4f2dbd48fd0e29840efc3d4cb91e27de2a4ea9009a64aab7c",
  "./assets/exercise-guides/0603-poster.png": "0b4769ee25393a719ddfc709d99ae3c17f139774ec39ce055df03f76876edff9",
  "./assets/exercise-guides/0603.gif": "09fdba60eaa86d3c579a7a52999aea7121995582f4c05d27944ebafa795a36eb",
  "./assets/exercise-guides/0643-poster.png": "f08c4bd6a374cf3a869e4e8d39a0a1ae269dd5725ef2770c97a509892a18075e",
  "./assets/exercise-guides/0643.gif": "6e383b93c60f3ee769a973984a844bfc4ce929b896cecfd93e212739dac5def8",
  "./assets/exercise-guides/0659-poster.png": "c9bb6c4bfc4d9d0ed3b096c808a91d6e3227d7172cd3e55f88db945a1627bf58",
  "./assets/exercise-guides/0659.gif": "37b0946491292c37aafd08bf8395c729d771838e0ecb9cac7c58ada648a09748",
  "./assets/exercise-guides/0669-poster.png": "ed623d98cc4034200a4ab6d00b9e517e0d9c942114db0b8b536d64ef4c198117",
  "./assets/exercise-guides/0669.gif": "2a2dcbde56b4a60d187c6dc37d7a7ca211b0c33fae9098d98b409626e0d9a084",
  "./assets/exercise-guides/0710-poster.png": "ae802282be64a6c1dc135c8557e464265a20d4eaf3947ad78b832b1750d3a38c",
  "./assets/exercise-guides/0710.gif": "684020568614f28b8adc282ea397680b3c85b8b6fb4fbceb025a060811c921f8",
  "./assets/exercise-guides/0794-poster.png": "271ffb4febcb2ee33304f1666a4c17357940812eceef9fb5346b784b6e07a492",
  "./assets/exercise-guides/0794.gif": "97568213dddb41b5cb42b7c68a94c0f2b6e0541575adb39d1047f0958d05e70b",
  "./assets/exercise-guides/1167-poster.png": "baba32fc33bbfe2ad997e9df63e5a38ae55d01c74ed60d29c5d68ec7e9a42fbf",
  "./assets/exercise-guides/1167.gif": "e888ef5f54234ff148e73692d30de131d8198c92be675f6e6b6be9840a64c6a6",
  "./assets/exercise-guides/1365-poster.png": "de30cdc72f1b6965e7eb119bc6a21f1cb886ccf65e118cb56dbf40178f5f65f9",
  "./assets/exercise-guides/1365.gif": "f33457594addb877a04400597684d73939527fb838926425f1f29f9363c61733",
  "./assets/exercise-guides/1368-poster.png": "ea831fe7e58c5ffa8ee7ee6057d4c0da550b523bd4179b46c9ba86515c0cd78a",
  "./assets/exercise-guides/1368.gif": "8c1eabe006d1db70f8dbedf8f01aecdfd5d15707465a24ac8954ec912b446544",
  "./assets/exercise-guides/1373-poster.png": "5439afa8cd4e8428a2aef6e511a51dc55af36b6b6b1b24967fd7a63a9726b7c1",
  "./assets/exercise-guides/1373.gif": "c01b09a2ea4318ef77c17e66641f48094769f7f41fb0c82e5a4757fcd9591a26",
  "./assets/exercise-guides/1377-poster.png": "4986604c4e92363a61a19a53b33639fcc894a76e33a56d996ac026960de9148d",
  "./assets/exercise-guides/1377.gif": "f33713f58035e2aab152e5f0207ef59d2b9c9475c31a785155d5a38e384ce547",
  "./assets/exercise-guides/1403-poster.png": "de2ac608b0513281085940fd27fd391faedbabfe001ea758323a5ed3fc411be9",
  "./assets/exercise-guides/1403.gif": "00cfd3c8f361daf0f60a0eefb083e96d8d165e3aa147fca940be23515ddeea1c",
  "./assets/exercise-guides/1424-poster.png": "e96882f7d53375118e53ccdbb3d1fc45449d047471d48d7af2a6fcccf1aaf464",
  "./assets/exercise-guides/1424.gif": "139b796a642ad7b9918910f4b1cd82d8b95a45bd59188590c854ce830dfadd8c",
  "./assets/exercise-guides/1428-poster.png": "df9fd7bc1b5a0a863348f269316f91cb1bf32bd49c6af33e2a2586757e866346",
  "./assets/exercise-guides/1428.gif": "e300a585781dfebc74fb5453b594c905dfcc13afbe2aea9ddae30c12206ec69f",
  "./assets/exercise-guides/1459-poster.png": "2dfdd425c68b0d264e4ae18f06e0b6f847a0275192e0eb67c2e96a1ecc7ca9b5",
  "./assets/exercise-guides/1459.gif": "e016d9e924e858e99330c21e963bf86575f8b2c2af73095a3e5f2d1510b3206b",
  "./assets/exercise-guides/1576-poster.png": "a36ca5a2362467a808aedb0678a05cca6dd57f666dee98724e965b12a208d886",
  "./assets/exercise-guides/1576.gif": "7fff1c4ea97efea27e9b9a794572949784628b77151d11b86931726a740d0e6f",
  "./assets/exercise-guides/1677-poster.png": "f96e6788168214cbcfa292d0afccd4cc6b9690c85be85706600ac7aad811da49",
  "./assets/exercise-guides/1677.gif": "be3c664164fb53aeba6d7ca84763dd12edd9aed931a304e3c466edd3f459292a",
  "./assets/exercise-guides/2133-poster.png": "569d4ea1c020c1e0e439289425e303644e51e974f89e6f99e39ff1b71bd37100",
  "./assets/exercise-guides/2133.gif": "3fd4146f9342ea3b84cd9e462ace73612d19731a9a56293061f249cf0552ffc3",
  "./assets/exercise-guides/2287-poster.png": "1c2e006739e70d025f1e5ed5774fce040d7aaacfd0965b1f1aaa76493d53c496",
  "./assets/exercise-guides/2287.gif": "5c658a64a070a72ecc863c38634ae2776934d63faefb67ff7921a92ef45e295a",
  "./assets/exercise-guides/3013-poster.png": "8ba0f9d1cde070e741b423443e577da5dbcd5790a7c5a98dd2096565621f756c",
  "./assets/exercise-guides/3013.gif": "35417faf76b51c5e2bfddb47751730e5cee0d953d37a054795ba50ee22ded1fc",
  "./assets/exercise-guides/3221-poster.png": "a6c404ced5c59b854c638b7e78d63eba982f6fd23ede272b7e86265f13b24fc6",
  "./assets/exercise-guides/3221.gif": "4e66b42df0d2706d58aadcfcfd94c7eda79cca048bd7e9c244d349af686bf0fd",
  "./assets/exercise-guides/bird-dog-poster.png": "abc3646181d82940d2b182c03c3aa266a43e3510c9233ce0820b5e2826c81b70",
  "./assets/exercise-guides/bird-dog.gif": "7aeb8cb5dcd93e6ff87de567956b618ed6d4b57a3a8236aa9439c56bcaf995e0",
  "./assets/exercise-guides/generated/wall-plank-anatomy.png": "9335dcd995dbd244bda589ae4f85f9fb37c6c8703a28a686b5cb3c421026929e",
  "./assets/voice/countdown-3.m4a": "0d113b3c86ca3ea3e53942fc5722286db4ab9a6d7bee3aa42e0fcbbe42db2fc1",
  "./assets/voice/countdown-start.m4a": "50500157e0a0633a5c6c3e4df0aba54286dc2ba3f9f5abbc83655ffeed12d077",
  "./assets/voice/encourage-1.m4a": "274ea7b93bd66510b968acc447509c6f6052bcd1fe0f5970004a1f7e99442697",
  "./assets/voice/encourage-2.m4a": "c1a8e07e1fc12015ce931ca38862c99f8a90d82488e860d188ce69294088f6d4",
  "./assets/voice/encourage-3.m4a": "2ef519750d09de522e6ed6cbc7a990e88b231107f22d831886d7694b72e10dbb",
  "./assets/voice/encourage-4.m4a": "3d3e311bc66a350d014fc18124a3f999858faf4b9931cb989198b7b69c6aea09",
  "./assets/voice/encourage-5.m4a": "fbbcd33682480c743b635868cb73939bd15064dbc8c98b8fa078734017e4ec22",
  "./assets/voice/finish-done.m4a": "387d985431231971c7b19afe1178d293f5d30f977255c408897a8a09e35fce25",
  "./assets/voice/finish-stretch.m4a": "fa6b27813c5a561dcd20f6c350d652e6ebee05ed68c72c014280a9f6ca34dd5a",
  "./assets/voice/stretch-0643.m4a": "0fed026d9b54a7c77582b28048c705f698305b38bf53916c9b67788d9c71aab7",
  "./assets/voice/stretch-0669.m4a": "f48f8a958e11d0ab8e06aaf1a619f94f926827efb808a1a4cd0d0e07152de9a4",
  "./assets/voice/stretch-0794.m4a": "66d4adeeb2083a853cefda0c43ce941ab4eb15362e95e7bb3e637c39b0bf5b29",
  "./assets/voice/stretch-1365.m4a": "3420967ec3f0c24f095480619ae137bc39899bb38f6a62fc3374dc6c59e4b7b9",
  "./assets/voice/stretch-1377.m4a": "3480080fcbae619068bd7c9a8e67ba49c24eab1ff5f11cc67c5a3363a0f85631",
  "./assets/voice/stretch-1403.m4a": "833cb38bf455e84320bfb0b458b2508c7a650168bbf1c07173b0997501c61e3a",
  "./assets/voice/stretch-1424.m4a": "1ccac5fd84bd38b524f6d3448e19d1f433e4580af9b0d206cd8599b292b05b79",
  "./assets/voice/stretch-1576.m4a": "5ea4e9387a08ac04fd2eb5dbfd936147c051a801677348c0063ce49d1951fc19",
  "./assets/voice/switch-side.m4a": "40811110cf3938fc4f56d0de0806821cec9848d45b7c76544d7e27bee80083c4",
  "./assets/voice/warmup-0257.m4a": "beca94deb503ac10d7c952d8d7bb48118f8b5cbdc8de0d719184fb38c9f9ca03",
  "./assets/voice/warmup-1167.m4a": "1feedb94409b25a3e0c597c6d1bd10893e31d657c86f2e6117988250bb9380bc",
  "./assets/voice/warmup-1368.m4a": "170775ee4cb14a47c44228711143e12a6c258af2ba5fa59a2ec0706adc68865e",
  "./assets/voice/warmup-1428.m4a": "d37c96773e09ef2e3794f20ba1a49df09ff130b05a0b76cc1c9c76e733681ddd",
  "./assets/voice/warmup-3221.m4a": "001b1dfe1334ac48acdb3bd5bed9ec18793c5cfcaac48b594f09363955d71946",
  "./assets/voice/work-0276.m4a": "20b5bad917aa873a57e005300b53ee97560c12a84a7507ce38c12e1532d7f810",
  "./assets/voice/work-0291.m4a": "eee6650016a6e2ecfba71301515f38b4703e1423f7ae47f4acd7d54eab7677f1",
  "./assets/voice/work-0292.m4a": "a5a3c3f94b9534ea0865fc8157b4654ac24dbf295ab02774598a89c8d22f1a75",
  "./assets/voice/work-0404.m4a": "935d07508f337b5b5faddf38a493f6824b33c1d6edf481fbe6dc5b8eb2da04dc",
  "./assets/voice/work-0576.m4a": "de634bbd38934bd4a7447de1f1316b03ce3f994e6c46875089a5151e2dbde1d9",
  "./assets/voice/work-0579.m4a": "7512b00dc28f765b9ffc2fac04cfbe7aff1b33878469e714e653200a210b1de9",
  "./assets/voice/work-0588.m4a": "91c38a52864605a6273234b53d18769809e48f38ab4388027e42bb27722e86af",
  "./assets/voice/work-0599.m4a": "1ffa183598c1a9e2d432fb950fbe6381a4fd49726c4cf3cb7f96c3b2ec059d8b",
  "./assets/voice/work-0603.m4a": "4614cfdf6b6c75d3b8457ede9cca57e663dbf1684d33964b67b11c363eb377fc",
  "./assets/voice/work-0659.m4a": "fe8e355e75ad348421f85d5294c21fc038cf810ea44ef7aace9960da156ac9aa",
  "./assets/voice/work-0710.m4a": "c41f5d6437098114eb6f6ea668fa5c933b4bc56c2f7866093f69761843831e0f",
  "./assets/voice/work-1373.m4a": "407d7e13c773d84d55e2a66f02add2c0ecb9d22dae16f9c3449d835e37a01f00",
  "./assets/voice/work-1459.m4a": "c512f7f4bccfbf3a146a83072f69ab44dcfc58ee6396b102832712ff746210d3",
  "./assets/voice/work-1677.m4a": "30e4cc8987361289a3e4a5bdac6a9391e264d38816c7b341a32f3fd480ca016f",
  "./assets/voice/work-2287.m4a": "323ea5dabe76073f2da7e5bbe886f5f424b813876f6121d9d9bc283d3a903d2e",
  "./assets/voice/work-3013.m4a": "618a1bce96fcafa923ed58409b177ec2217f80c81a5e56e34041d2671fd21b49",
  "./content.js": "a3ac07e0fae3c7398d633231596b0b00380fcedcb424db50438a4fa4d257526c",
  "./icons/apple-touch-icon-180.png": "989da9616e205b878097be824e97fb7da865b4c7b9546933da28fa62bed47bb6",
  "./icons/icon-192.png": "6c392bf8142fee95fce333905eab906a62abd37c7781e84ea2c07ff8d95bdfac",
  "./icons/icon-512-maskable.png": "b5b9a9e528e6f024db137a1ba0986f33b6c355c8608108d3e020bfdd29721153",
  "./icons/icon-512.png": "b5b9a9e528e6f024db137a1ba0986f33b6c355c8608108d3e020bfdd29721153",
  "./index.html": "cdc543b3041248d0c7ae423bd7d1282009bf17d1e1e4fa3b7db6bea91f91d821",
  "./manifest.webmanifest": "aa399110c2c1cb0ebb99e5584cc29311e7b019f68b5448f72f317a7c62a853d0",
  "./session.js": "cd0bbf1249e8e226bb87557316320d0a888c9db4bebc180870d870aff23685b7",
  "./styles.css": "ca2b4d69473287ec6518c8562a526c0be7f5751a0896a18d17b78c10f4f0a876"
} /* BUILD_HASHES_END */;

var SCOPE = new URL(self.registration.scope);
var CACHE_PREFIX = 'qingdaka-habits:' + encodeURIComponent(SCOPE.href) + ':';
var LEGACY_PREFIX = 'workbuddy:' + encodeURIComponent(SCOPE.href) + ':';
var CACHE_NAME = CACHE_PREFIX + VERSION;
var FILES = new Map(CORE.map(function (file) {
  return [new URL(file, SCOPE).href, file];
}));
var installation;

async function checkedFetch(url, file) {
  var response = await fetch(url, { cache: 'no-store', credentials: 'same-origin', redirect: 'error' });
  if (!response || response.status !== 200 || response.redirected || response.type === 'opaque') {
    throw new Error('offline-file-unavailable: ' + file);
  }
  var expected = RELEASE_HASHES[file];
  if (COMPLETE_RELEASE && !expected) { throw new Error('offline-integrity-missing: ' + file); }
  if (expected) {
    var digest = await crypto.subtle.digest('SHA-256', await response.clone().arrayBuffer());
    var actual = Array.from(new Uint8Array(digest), function (byte) {
      return byte.toString(16).padStart(2, '0');
    }).join('');
    if (actual !== expected) { throw new Error('offline-version-mismatch: ' + file); }
  }
  return response;
}

async function offlineStatus() {
  try {
    if (!(await caches.keys()).includes(CACHE_NAME)) {
      return { ready: false, version: VERSION, courseReady: false };
    }
    var cache = await caches.open(CACHE_NAME);
    var hits = await Promise.all(CORE.map(function (file) {
      return cache.match(new URL(file, SCOPE).href);
    }));
    var ready = hits.length > 0 && hits.every(function (response) { return response && response.status === 200; });
    return {
      ready: ready,
      version: VERSION,
      courseReady: ready && CORE.some(function (file) {
        return file.indexOf('./assets/exercise-guides/') === 0;
      })
    };
  } catch (error) {
    return { ready: false, version: VERSION, courseReady: false };
  }
}

async function installRelease() {
  var existed = (await caches.keys()).includes(CACHE_NAME);
  try {
    var responses = await Promise.all(CORE.map(function (file) {
      return checkedFetch(new URL(file, SCOPE).href, file);
    }));
    var cache = await caches.open(CACHE_NAME);
    var writes = await Promise.allSettled(CORE.map(function (file, index) {
      return cache.put(new URL(file, SCOPE).href, responses[index]);
    }));
    var failed = writes.find(function (result) { return result.status === 'rejected'; });
    if (failed) { throw failed.reason; }
    if (!(await offlineStatus()).ready) { throw new Error('offline-release-incomplete'); }
  } catch (error) {
    if (!existed) { await caches.delete(CACHE_NAME); }
    throw error;
  }
}

self.addEventListener('install', function (event) {
  installation = installRelease();
  event.waitUntil(installation.then(function () {
    return self.skipWaiting();
  }));
});

self.addEventListener('activate', function (event) {
  event.waitUntil((async function () {
    if (!(await offlineStatus()).ready) { throw new Error('offline-release-incomplete'); }
    var keys = await caches.keys();
    await Promise.all(keys.filter(function (key) {
      return key !== CACHE_NAME && (key.indexOf(CACHE_PREFIX) === 0 || key.indexOf(LEGACY_PREFIX) === 0);
    }).map(function (key) { return caches.delete(key); }));
    await self.clients.claim();
  })());
});

self.addEventListener('message', function (event) {
  if (!event.data) { return; }
  if (event.data.type === 'ACTIVATE_UPDATE') {
    event.waitUntil((async function () {
      if (installation) { await installation; }
      if ((await offlineStatus()).ready) { await self.skipWaiting(); }
    })());
  }
  if (event.data.type === 'OFFLINE_STATUS' && event.ports && event.ports[0]) {
    event.waitUntil(offlineStatus().then(function (status) { event.ports[0].postMessage(status); }));
  }
});

function rangeResponse(response, rangeHeader) {
  return response.arrayBuffer().then(function (buffer) {
    var match = /^bytes=(\d*)-(\d*)$/i.exec(String(rangeHeader || '').trim());
    var size = buffer.byteLength;
    var start, end;
    if (!match || (!match[1] && !match[2])) {
      return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + size } });
    }
    if (!match[1]) {
      var suffixLength = Number(match[2]);
      if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
        return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + size } });
      }
      start = Math.max(0, size - suffixLength);
      end = size - 1;
    } else {
      start = Number(match[1]);
      end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
    }
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= size || end < start) {
      return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + size } });
    }
    var headers = new Headers(response.headers);
    headers.set('Accept-Ranges', 'bytes');
    headers.set('Content-Range', 'bytes ' + start + '-' + end + '/' + size);
    headers.set('Content-Length', String(end - start + 1));
    return new Response(buffer.slice(start, end + 1), { status: 206, statusText: 'Partial Content', headers: headers });
  });
}

async function cacheFirst(url, file, rangeHeader) {
  var cache, hit;
  try {
    cache = await caches.open(CACHE_NAME);
    hit = await cache.match(url);
    if (hit) {
      return rangeHeader ? rangeResponse(hit, rangeHeader) : hit;
    }
  } catch (error) {}
  try {
    var response = await checkedFetch(url, file);
    try {
      if (cache) { await cache.put(url, response.clone()); }
    } catch (error) {}
    return rangeHeader ? rangeResponse(response, rangeHeader) : response;
  } catch (error) {
    return new Response('This release is unavailable offline. Reconnect and accept the complete update.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }
    });
  }
}

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET') { return; }
  var url = new URL(request.url);
  if (url.origin !== SCOPE.origin || url.pathname.indexOf(SCOPE.pathname) !== 0) { return; }
  url.search = '';
  url.hash = '';
  if (url.pathname === SCOPE.pathname) { url = new URL('./index.html', SCOPE); }
  var file = FILES.get(url.href);
  if (!file && !COMPLETE_RELEASE) {
    var relative = url.pathname.slice(SCOPE.pathname.length);
    if (/^assets\/(?:exercise-guides\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.(?:png|gif)|voice\/[a-zA-Z0-9_-]+\.m4a)$/.test(relative)) {
      file = './' + relative;
    }
  }
  if (!file) { return; }
  var rangeHeader = request.headers && typeof request.headers.get === 'function' ? request.headers.get('Range') : null;
  event.respondWith(cacheFirst(url.href, file, rangeHeader));
});
