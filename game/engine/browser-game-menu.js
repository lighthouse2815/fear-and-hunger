'use strict';
(function (root) {
    function node(tag,text,className) {
        var element=document.createElement(tag);if(text!=null)element.textContent=text;if(className)element.className=className;return element;
    }
    function render(ui,actorId) {
        var engine=ui.engine,state=engine.state,db=engine.database,system=db.System,actor=actorId && state.actor(actorId),content=ui.content;
        var view=ui.gameMenu || (ui.gameMenu={}), previous=document.activeElement;
        var focusKey=content.contains(previous) && previous.dataset.menuKey;
        content.replaceChildren();content.dataset.menuPage=ui.tab;
        function frame(id,x,y,w,h,columns) {
            var panel=node('section',null,'fnh-menu-window');panel.dataset.window=id;
            Object.assign(panel.style,{left:x/816*100+'%',top:y/624*100+'%',width:w/816*100+'%',height:h/624*100+'%'});
            ui.options.windowBackground(panel,w,h);content.appendChild(panel);
            if(columns) {panel.dataset.columns=columns;panel.classList.add('fnh-menu-list');panel.style.gridTemplateColumns='repeat('+columns+',minmax(0,1fr))';}
            return panel;
        }
        function help(text) {if(ui.options.richText)ui.options.richText(helpPanel,text||'');else helpPanel.textContent=root.FNHStandaloneText.formatText(text||'',state);}
        function button(parent,text,key,action,description,enabled) {
            var b=node('button');if(text)b.appendChild(node('span',text));b.type='button';b.dataset.menuKey=key;b.disabled=ui.busy || enabled===false;
            b.onclick=function () {if(!b.disabled)action();};
            b.onfocus=function () {parent.querySelectorAll('button').forEach(function (other) {other.dataset.selected=String(other===b);});help(typeof description==='function'?description():description);};
            b.onpointermove=function () {if(!b.disabled && document.activeElement!==b)b.focus({preventScroll:true});};
            parent.appendChild(b);return b;
        }
        function icon(index) {
            var image=node('span',null,'fnh-game-menu-icon');image.style.backgroundPosition=(index%16/15*100)+'% '+(Math.floor(index/16)/19*100)+'%';return image;
        }
        function itemButton(parent,item,key,amount,action,description,enabled) {
            var b=button(parent,'',key,action,description==null?item.description:description,enabled);
            b.append(icon(item.iconIndex||0),node('span',item.name,'fnh-game-menu-item-name'));
            if(amount!=null)b.appendChild(node('span',amount,'fnh-game-menu-amount'));return b;
        }
        function first(panel) {var b=panel.querySelector('button:enabled');if(b)b.focus({preventScroll:true});}
        function refresh(key) {ui.render();if(key){var b=Array.from(content.querySelectorAll('[data-menu-key]')).find(function (b) {return b.dataset.menuKey===key;});if(b)b.focus({preventScroll:true});}}
        function changeCategory(key,value) {view[key]=value;refresh();}
        function face(parent,member) {
            var image=node('span',null,'fnh-game-menu-face');
            image.style.backgroundImage='url("./img/faces/'+encodeURIComponent(member.faceName)+'.png")';
            image.style.backgroundPosition=member.faceIndex%4/3*100+'% '+Math.floor(member.faceIndex/4)*100+'%';parent.appendChild(image);
        }
        function gauge(parent,label,value,max,kind) {
            var row=node('div',null,'fnh-game-menu-gauge '+kind);row.append(node('span',label),node('span',value+' / '+max));
            var bar=node('meter');bar.min=0;bar.max=Math.max(1,max);bar.value=value;bar.setAttribute('aria-label',label);row.appendChild(bar);parent.appendChild(row);
        }
        function status(panel,member) {
            face(panel,member);var info=node('div',null,'fnh-game-menu-actor-info');
            var change=button(info,member.name,'actor',function () {var index=state.party.indexOf(actorId);ui.actorSelect.value=state.party[(index+1)%state.party.length];refresh('actor');},member.nickname);
            change.dataset.actor=member.id;info.appendChild(node('span',db.Classes[member.classId].name,'fnh-game-menu-class'));
            gauge(info,'Body',member.hp,state.actorParam(member.id,0),'hp');gauge(info,'Mind',member.mp,state.actorParam(member.id,1),'mp');panel.appendChild(info);
        }
        function use(kind,data) {
            if([7,9].includes(data.scope)) {view.target={kind:kind,id:data.id,actorId:actorId};refresh('target-'+actorId);}
            else ui.act(function () {return kind==='item'?engine.useMenuItem(data.id,actorId,ui.handlers):engine.useMenuSkill(actorId,data.id,actorId,ui.handlers);});
        }
        var helpPanel=frame('help',0,0,816,108);
        if(ui.tab==='inventory') {
            var category=view.itemCategory||'items',categories=frame('category',0,108,816,72,4),list=frame('items',0,180,816,444,2);
            [['items',system.terms.commands[4]],['weapons',system.terms.commands[12]],['armors',system.terms.commands[13]],['books',system.terms.commands[14]]].forEach(function (entry) {
                var b=button(categories,entry[1],'category-'+entry[0],function () {changeCategory('itemCategory',entry[0]);first(content.querySelector('[data-window="items"]'));});
                b.dataset.selected=String(category===entry[0]);b.onfocus=function () {if(view.itemCategory!==entry[0])changeCategory('itemCategory',entry[0]);};
            });
            var kind=category==='books'?'items':category,table=db[{items:'Items',weapons:'Weapons',armors:'Armors'}[kind]];
            Object.keys(state.inventory[kind]).map(Number).sort(function(a,b){return a-b;}).forEach(function (id) {
                var item=table[id];if(!item || state.itemCount(kind,id)<=0 || kind==='items' && (item.itypeId===2)!==(category==='books'))return;
                var usable=kind==='items' && state.party.some(function (id) {return engine.canUseMenuItem(item.id,id);});
                var b=itemButton(list,item,'item-'+kind+'-'+id,': '+state.itemCount(kind,id),function () {if(usable)use('item',item);});
                b.dataset.item=id;b.dataset.kind=kind;b.classList.toggle('fnh-menu-unusable',!usable);b.setAttribute('aria-disabled',String(!usable));
            });
        } else if(ui.tab==='equipment' && actor) {
            var stats=frame('equipment-status',0,108,312,288),commands=frame('equipment-command',312,108,504,72,3),slots=frame('equipment-slots',312,180,504,216,1),items=frame('equipment-items',0,396,816,228,2);
            button(stats,actor.name,'actor',function () {ui.actorSelect.value=state.party[(state.party.indexOf(actorId)+1)%state.party.length];view.equipSlot=null;refresh('actor');},actor.nickname);
            for(var param=2;param<8;param++) {var row=node('div',null,'fnh-game-menu-param');row.append(node('span',system.terms.params[param]),node('span',state.actorParam(actorId,param)),node('span','→'),node('span',''));row.dataset.param=param;stats.appendChild(row);}
            button(commands,system.terms.commands[15],'equip',function () {first(slots);});
            button(commands,system.terms.commands[16],'optimize',function () {ui.act(function () {engine.optimizeMenuEquipment(actorId);});}).dataset.equipmentAction='optimize';
            button(commands,system.terms.commands[17],'clear',function () {ui.act(function () {engine.clearMenuEquipment(actorId);});}).dataset.equipmentAction='clear';
            actor.equips.forEach(function (equipped,slot) {
                var table=db[slot===0?'Weapons':'Armors'],item=table[equipped];
                var b=button(slots,'','slot-'+slot,function () {view.equipSlot=slot;refresh('equipment-'+equipped);},item&&item.description,engine.canChangeMenuEquipment(actorId,slot));b.dataset.slot=slot;
                b.appendChild(node('span',system.equipTypes[slot+1],'fnh-game-menu-slot-name'));if(item)b.append(icon(item.iconIndex),node('span',item.name));
                b.onfocus=function () {help(item&&item.description);if(view.equipSlot!==slot){view.equipSlot=slot;refresh('slot-'+slot);}};
            });
            if(view.equipSlot!=null) {
                var slot=view.equipSlot,table=db[slot===0?'Weapons':'Armors'];
                [null].concat(table.filter(function (item) {return item && engine.canEquipMenuActor(actorId,slot,item.id);})).forEach(function (item) {
                    var id=item?item.id:0;
                    var b=itemButton(items,item||{name:'',iconIndex:0},'equipment-'+id,item?': '+state.itemCount(slot===0?'weapons':'armors',id):null,function () {
                        ui.act(function () {if(!engine.equipMenuActor(actorId,slot,id))throw new Error('Không thể đổi trang bị này.');});
                    },item&&item.description,engine.canChangeMenuEquipment(actorId,slot));b.dataset.equipItem=id;
                    var focus=b.onfocus;b.onfocus=function () {
                        focus();var snapshot=Object.assign({},actor,{equips:actor.equips.slice()});snapshot.equips[slot]=id;
                        var preview=new root.FNHStandaloneActors.ActorState(db.Actors[actorId],db.Classes[actor.classId],snapshot,db);
                        stats.querySelectorAll('[data-param]').forEach(function (row) {
                            var param=Number(row.dataset.param),next=preview.maxParam(db.Actors[actorId],db.Classes[actor.classId],param),current=state.actorParam(actorId,param);
                            row.lastChild.textContent=next;row.lastChild.dataset.change=next>current?'increase':next<current?'decrease':'same';
                        });
                    };
                });
            }
        } else if(ui.tab==='skills' && actor) {
            var types=frame('skill-type',0,108,240,180,1),actorPanel=frame('skill-status',240,108,576,180),skills=frame('skills',0,288,816,336,2);
            status(actorPanel,actor);
            var entries=engine.battle.actorSkills(actorId),typeIds=Array.from(new Set(entries.map(function (skill) {return skill.stypeId;}))).sort();
            if(!typeIds.length)typeIds=[1];if(!typeIds.includes(view.skillType))view.skillType=typeIds[0];
            typeIds.forEach(function (id) {var b=button(types,system.skillTypes[id]||'Skills','skill-type-'+id,function () {view.skillType=id;refresh();first(content.querySelector('[data-window="skills"]'));});b.dataset.selected=String(view.skillType===id);b.onfocus=function () {if(view.skillType!==id)changeCategory('skillType',id);};});
            entries.filter(function (skill) {return skill.stypeId===view.skillType;}).forEach(function (skill) {
                var cost=engine.battle.skillCost({id:actorId},skill),usable=state.party.some(function (id) {return engine.canUseMenuSkill(actorId,skill.id,id);});
                var b=itemButton(skills,skill,'skill-'+skill.id,cost.tp||cost.mp||'',function () {if(usable)use('skill',skill);});b.dataset.skill=skill.id;b.classList.toggle('fnh-menu-unusable',!usable);b.setAttribute('aria-disabled',String(!usable));
            });
        } else if(ui.tab==='synthesis') {
            var recipes=engine.synthesisRecipes(),kinds=['item','weapon','armor'].filter(function (kind) {return recipes.some(function (recipe) {return recipe.kind===kind;});});
            if(!kinds.includes(view.recipeKind))view.recipeKind=kinds[0]||'item';
            var commands=frame('synthesis-command',0,108,240,180,1),summary=frame('synthesis-status',240,108,576,180),list=frame('recipes',0,288,408,336,1),ingredients=frame('ingredients',408,288,408,264),gold=frame('gold',408,552,408,72);
            kinds.forEach(function (kind) {var b=button(commands,'Craft '+{item:'Item',weapon:'Weapon',armor:'Armor'}[kind],'recipe-kind-'+kind,function () {view.recipeKind=kind;refresh();first(content.querySelector('[data-window="recipes"]'));});b.dataset.selected=String(view.recipeKind===kind);b.onfocus=function () {if(view.recipeKind!==kind)changeCategory('recipeKind',kind);};});
            button(commands,'Finish','synthesis-finish',function () {ui.focusCommand();});
            var totalRecipes=0,collected=0,totals={item:0,weapon:0,armor:0};
            [['Items','item'],['Weapons','weapon'],['Armors','armor']].forEach(function (entry) {db[entry[0]].filter(Boolean).forEach(function (item) {
                var note=item.note||'',count=Array.from(note.matchAll(/<(?:Item|Weapon|Armor) Recipe:\s*([^>]+)>/ig)).reduce(function (sum,match) {return sum+match[1].split(',').filter(function (value) {return Number(value.trim())>0;}).length;},0);
                totalRecipes+=count;if(state.itemCount(entry[1]+'s',item.id)>0)collected+=count;
                if(/<Synthesis Ingredients>/i.test(note))totals[entry[1]]++;
            });});
            function synthesisCount(label,count,total) {var row=node('div',null,'fnh-game-menu-summary');row.append(node('span',label),node('span',count+'/'+total),node('span',Math.floor(count/Math.max(1,total)*100)+'%'));summary.appendChild(row);}
            synthesisCount('Collected Recipes',collected,totalRecipes);
            ['item','weapon','armor'].forEach(function (kind) {synthesisCount('Crafted '+{item:'Items',weapon:'Weapons',armor:'Armors'}[kind],Object.keys(state.synthesis.crafted[kind+'s']).length,totals[kind]);});
            gold.appendChild(node('span',state.gold,'fnh-game-menu-gold'));
            recipes.filter(function (recipe) {return recipe.kind===view.recipeKind;}).forEach(function (recipe) {
                var b=itemButton(list,{name:recipe.name,iconIndex:recipe.item.iconIndex},'recipe-'+recipe.kind+'-'+recipe.id,null,function () {
                    if(!engine.canSynthesize(recipe))return;
                    ui.act(async function () {engine.synthesize(recipe);if(ui.handlers.effect)await ui.handlers.effect(250,[{name:'fnh_choice2',volume:100,pitch:100,pan:0}]);});
                },recipe.known?recipe.item.description:'This item has not been crafted yet.');b.dataset.synthesis=recipe.kind+':'+recipe.id;b.classList.toggle('fnh-menu-unusable',!engine.canSynthesize(recipe));
                var focus=b.onfocus;b.onfocus=function () {focus();ingredients.replaceChildren(node('div','Ingredients','fnh-game-menu-system'));recipe.ingredients.forEach(function (entry) {
                    var table=db[{item:'Items',weapon:'Weapons',armor:'Armors'}[entry.kind]],name=entry.kind==='gold'?'Gold':table[entry.id].name,amount=entry.kind==='gold'?state.gold:state.itemCount(entry.kind+'s',entry.id);
                    ingredients.appendChild(node('div',name+'  '+amount+'/'+entry.amount));
                });};
            });
        } else if(ui.tab==='options') {
            var categories=frame('options-category',0,108,240,516,1),options=frame('options',240,108,576,516,1),category=view.optionCategory||'All',settings=ui.options.settings;
            ['All','General','Audio','Controls','Exit'].forEach(function (name) {var b=button(categories,name,'options-'+name,function () {if(name==='Exit')ui.focusCommand();else first(options);},name==='All'?"A list of all of the game's settings.":name+' settings.');b.dataset.selected=String(category===name);b.onfocus=function () {if(name!=='Exit' && view.optionCategory!==name)changeCategory('optionCategory',name);};});
            if(category==='All'||category==='General') {
                var widths=['small','medium','large'],widthLabels=['Small','Medium','Large'];
                function setWidth(step) {
                    var before=settings.screenWidth,index=widths.indexOf(before);
                    settings.screenWidth=widths[(index+step+widths.length)%widths.length];
                    try {settings.save();ui.options.applyScreenWidth();refresh('option-screenWidth');}
                    catch(error) {settings.screenWidth=before;ui.message.textContent=error.message;}
                }
                var widthButton=button(options,'Screen Size','option-screenWidth',function () {setWidth(1);},'Change the size of the game screen.');
                widthButton.appendChild(node('span',widthLabels[widths.indexOf(settings.screenWidth)],'fnh-game-menu-amount'));
                widthButton.onkeydown=function (event) {var action=ui.options.input(event.key);if(action==='left'||action==='right'){event.preventDefault();event.stopPropagation();setWidth(action==='left'?-1:1);}};
                [['commandRemember','Command Remember'],['filterEffects','Filter Effects']].forEach(function (entry) {
                    function setOption(value) {var before=settings[entry[0]];settings[entry[0]]=value;try{settings.save();if(entry[0]==='filterEffects')state.setSwitch(3520,settings.filterEffects);refresh('option-'+entry[0]);}catch(error){settings[entry[0]]=before;ui.message.textContent=error.message;}}
                    var b=button(options,entry[1],'option-'+entry[0],function () {setOption(!settings[entry[0]]);},entry[0]==='commandRemember'?'Game remembers the last command selected during battle.':'Enable or disable the Filter Effects.');
                    var values=node('span',null,'fnh-game-menu-toggle');
                    [false,true].forEach(function (value) {var text=node('span',value?'ON':'OFF');text.dataset.selected=String(settings[entry[0]]===value);values.appendChild(text);});b.appendChild(values);
                    b.onkeydown=function (event) {var action=ui.options.input(event.key);if(action==='left'||action==='right'){event.preventDefault();event.stopPropagation();setOption(action==='right');}};
                });
                options.appendChild(node('div','\u00a0'));
            }
            if(category==='All'||category==='Audio') {
                [['master','Master Volume'],['bgm','BGM Volume'],['bgs','BGS Volume'],['me','ME Volume'],['se','SE Volume']].forEach(function (entry) {
                    var b=button(options,entry[1],'volume-'+entry[0],function () {adjust(20,true);},'Adjusts the volume of the game.');b.dataset.volume=entry[0];
                    var value=node('span',settings.volumes[entry[0]]+'%','fnh-game-menu-amount'),meter=node('meter');meter.min=0;meter.max=100;meter.value=settings.volumes[entry[0]];b.append(value,meter);
                    function adjust(delta,wrap) {try{var next=settings.volumes[entry[0]]+delta;ui.options.updateVolume(entry[0],wrap && next>100?0:Math.max(0,Math.min(100,next)));value.textContent=settings.volumes[entry[0]]+'%';meter.value=settings.volumes[entry[0]];}catch(error){ui.message.textContent=error.message;}}
                    b.onkeydown=function (event) {var action=ui.options.input(event.key);if(action==='left'||action==='right'){event.preventDefault();event.stopPropagation();adjust(action==='left'?-20:20,false);}};
                });
                options.appendChild(node('div','\u00a0'));
            }
            if(category==='All'||category==='Controls')button(options,'Keyboard Config','keyboard-config',function () {view.keyboard=true;refresh('key-action');},"Configure the game's keyboard settings.");
            if(view.keyboard) {
                var keyboard=frame('keyboard',0,0,816,624),action=node('select');action.dataset.menuKey='key-action';action.id='fnh-key-action';action.setAttribute('aria-label','Hành động của phím');
                ['','down','left','right','up','ok','cancel','shift','pageup','pagedown','torch','skill'].forEach(function (name) {var option=node('option',name||'Không gán');option.value=name;action.appendChild(option);});
                var input=node('input');input.id='fnh-key-input';input.readOnly=true;input.placeholder='Nhấn phím để gán';input.onkeydown=function (event) {event.preventDefault();event.stopPropagation();try{settings.bind(event.key,action.value);input.value=event.key;ui.options.clearInput();}catch(error){ui.message.textContent=error.message;}};
                keyboard.append(action,input);
                [['default',false],['WASD',true]].forEach(function (entry) {button(keyboard,entry[0],'layout-'+entry[0],function () {try{settings.layout(entry[1]);ui.options.clearInput();}catch(error){ui.message.textContent=error.message;}});});
                var bindings=node('dl');Object.keys(settings.keys).filter(function (key) {return settings.keys[key];}).forEach(function (key) {bindings.append(node('dt',key),node('dd',settings.keys[key]));});keyboard.appendChild(bindings);
            }
            help(category==='All'?"A list of all of the game's settings.":category+' settings.');
        } else if(ui.tab==='gameEnd') {
            helpPanel.remove();var commands=frame('game-end',288,258,240,108,1);
            button(commands,system.terms.commands[21],'to-title',function () {ui.act(function () {engine.returnMenuToTitle();});}).id='fnh-menu-to-title';
            button(commands,system.terms.commands[22],'end-cancel',function () {ui.focusCommand();}).id='fnh-menu-end-cancel';
        }
        if(view.target) {
            var selected=view.target,data=db[selected.kind==='item'?'Items':'Skills'][selected.id],targets=frame('target',0,0,816,624,1);targets.classList.add('fnh-game-menu-targets');
            state.party.forEach(function (id) {
                var member=state.actor(id),enabled=selected.kind==='item'?engine.canUseMenuItem(selected.id,id):engine.canUseMenuSkill(selected.actorId,selected.id,id);
                var b=button(targets,'','target-'+id,function () {ui.act(function () {view.target=null;return selected.kind==='item'?engine.useMenuItem(selected.id,id,ui.handlers):engine.useMenuSkill(selected.actorId,selected.id,id,ui.handlers);});},data.description,enabled);b.dataset.targetActor=id;
                face(b,member);b.appendChild(node('span',member.name));gauge(b,'Body',member.hp,state.actorParam(id,0),'hp');gauge(b,'Mind',member.mp,state.actorParam(id,1),'mp');
            });
        }
        if(focusKey) {var current=Array.from(content.querySelectorAll('[data-menu-key]')).find(function (b) {return b.dataset.menuKey===focusKey && !b.disabled;});if(current)current.focus({preventScroll:true});}
    }
    function back(ui) {
        var view=ui.gameMenu||{};
        if(ui.partyCommand){ui.partyCommand=null;ui.focusCommand();return true;}
        if(view.target || view.keyboard){view.target=null;view.keyboard=false;ui.render();ui.focusCommand();return true;}
        if(ui.content.contains(document.activeElement)){ui.focusCommand();return true;}
        return false;
    }
    function handleKey(ui,event) {
        var action=ui.options.input(event.key),target=event.target;
        if(!ui.content.contains(target) || target.closest('input,select,textarea'))return false;
        if(['pageup','pagedown'].includes(action)) {
            var ids=ui.engine.state.party,index=ids.indexOf(Number(ui.actorSelect.value));
            ui.actorSelect.value=ids[(index+(action==='pageup'?-1:1)+ids.length)%ids.length];ui.gameMenu.equipSlot=null;ui.render();
            if(!ui.content.contains(document.activeElement))ui.enterContent();
        } else if(['up','down','left','right'].includes(action)) {
            var parent=target.closest('.fnh-menu-window') || ui.content,buttons=Array.from(parent.querySelectorAll('button:enabled')),index=buttons.indexOf(target),columns=Number(parent.dataset.columns)||1;
            var step=action==='up'?-columns:action==='down'?columns:action==='left'?-1:1;
            if(buttons.length)buttons[(index+step+buttons.length)%buttons.length].focus({preventScroll:true});
        } else if(action==='ok' && target.tagName==='BUTTON'){if(!event.repeat)target.click();}
        else return false;
        event.preventDefault();event.stopPropagation();return true;
    }
    root.FNHStandaloneGameMenu={render:render,back:back,handleKey:handleKey};
}(typeof globalThis!=='undefined'?globalThis:this));
