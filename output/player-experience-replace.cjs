const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '../prototype/js/merge/ui.js');
let text = fs.readFileSync(file, 'utf8');
const replacements = [
 ['信任、疗愈、宗门阅历', '信任、疗愈、住客成长'],
 ['多少疗愈值与宗门阅历', '多少疗愈值与住客成长'],
 ['医馆提升疗愈和宗门阅历', '医馆提升疗愈和住客成长'],
 ['梳洗台提高高阶奖励概率', '梳洗台提高额外基础素材概率'],
 ['<span>宗门阅历</span><div class="meter">', '<span>住客成长</span><div class="meter">'],
 ["' · 宗门阅历 ' + entry.exp", "' · 住客成长 ' + entry.exp"],
 [' · 宗门阅历 +10%', ' · 住客成长收益 +10%'],
 [' · 宗门阅历+10%', ' · 住客成长收益+10%'],
 [' · 开局提示 +', ' · 每局手动提示 '],
 [' · 梳洗奖励加成 ', ' · A/S额外T1概率 '],
 [' · 梳洗奖励 ', ' · A/S额外T1概率 '],
 [' · 提示 +', ' · 每局手动提示 '],
 ["' · 宗门阅历' + gate.missing.exp", "' · 住客成长' + gate.missing.exp"],
 ["growthRow('宗门阅历', entry.exp", "growthRow('住客成长', entry.exp"],
 ["openCareLoaded(session.type, session.difficulty, { practice: true });", "openCareLoaded(session.type, session.difficulty, Object.assign({}, session.runContext, { practice: true, facilityLevel: state.facilities.play.level }));"],
 ["characterAssetPath(beastArt(beastDef(session.beastId), state.beastCases[session.beastId]))", "session.runContext.portrait"]
];
for (const [from,to] of replacements) {
 if (!text.includes(from)) throw new Error('Missing replacement: ' + from);
 text=text.split(from).join(to);
}
fs.writeFileSync(file,text);
console.log('Updated resident terminology and frozen result portraits.');
