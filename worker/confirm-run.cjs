'use strict';
const fs=require('node:fs');global.KakeiboCsv13Stage=require('../webapp/Csv13Stage');global.KakeiboCore=require('../webapp/Core');global.KakeiboCsv=require('../webapp/Csv');global.KakeiboMail=require('../webapp/Mail');
const x=JSON.parse(fs.readFileSync(0,'utf8')),expected=x.validated.confirmation_expectations;
if(!expected)throw Error('CONFIRM_EXACT_VALIDATED_OUTPUT_REQUIRED');
const today=new Date(Date.parse(x.validated.generated_at)+9*3600000).toISOString().slice(0,10);
const state=x.after.tables?require('../webapp/Store').decode(x.after.tables,today).state:x.after.state;
if(!state)throw Error('CONFIRM_COMPLETE_SNAPSHOT_REQUIRED');
const checked=KakeiboCore.validate(state);
const result=require('./confirm_details.cjs').confirm(checked,expected);
// Wall clock originates here, never from JSON or a model-authored observed_at.
const clock=require('../tools/observed_clock_guard.cjs').check(checked,x.validated,Date.now());
result.observed_clock=clock;
if(!clock.ok){result.complete=false;result.reasons.push(...clock.reasons);}
console.log(JSON.stringify(result));
