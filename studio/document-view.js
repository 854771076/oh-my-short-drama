const labels={episode_key:'分集',project_key:'项目',title:'标题',name:'名称',type:'类型',status:'状态',characters:'人物',scenes:'场景',props:'道具',shots:'镜头',panels:'分镜卡',versions:'版本',key:'标识',label:'名称',description:'描述',visual_description:'视觉描述',evidence:'依据',source:'来源',locator:'位置',quote:'原文',trigger:'触发条件',derived_from:'衍生自',selected_version:'当前选版',duration_seconds:'时长（秒）',dialogue:'对白',action:'动作',prompt:'提示词',negative_prompt:'反向提示词',camera:'镜头语言',lighting:'光线',location:'地点',wardrobe:'服装',panel_number:'分镜号',shot_number:'镜头号',source_versions:'来源版本',director_book:'导演本',asset_plan:'资产计划',script:'剧本',scene_type:'场景类型',source_text:'原文对白',continuity_mode:'连续性方式',continuity_reason:'连续性说明',narrative_purpose:'叙事目的',shot_group:'镜头组',motion_plan:'运动计划',scene_strategy:'场景策略',rhythm_plan:'节奏计划',edit_plan:'剪辑计划',dialogue_plan:'对白计划',visual_plan:'画面计划',subject:'主体',start_state:'开始状态',end_state:'结束状态',verb:'动作',camera_role:'摄影作用',objective:'目标',viewpoint:'视角',tone:'情绪',pacing:'节奏',visual_motif:'画面母题',sound_motif:'声音母题',intensity:'强度',cut_motivation:'剪辑动机',axis:'轴线',screen_direction:'画面方向',transition:'转场',sound_bridge:'声音桥',intended_duration:'计划时长',standout:'重点镜头',technique:'手法',appearance:'外观',slot:'位置',function:'功能',image_strategy:'分镜图片策略',board_type:'分镜类型',overflow_strategy:'槽位溢出策略',reference_assets:'参考资产',video_strategy:'视频策略',audio_strategy:'声音策略',parameters:'模型参数',resolution:'分辨率',aspect_ratio:'画幅',ratio:'画幅',quality:'质量',speed:'语速',response_format:'音频格式',generate_audio:'生成原生声音',watermark:'水印',make_instrumental:'纯音乐'}
const escape=(value='')=>String(value).replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]))
const label=key=>labels[key]||key.replaceAll('_',' ')

function renderValue(value,depth,path=[],key=''){
  if(value===null||value===undefined)return '<span class="doc-empty">未设置</span>'
  if(Array.isArray(value))return value.length?`<div class="doc-array ${['panels','shots','storyboard'].includes(key)?'doc-card-grid':''}">${value.map((item,index)=>`<button type="button" class="doc-card" data-doc-card="${escape([...path,index].join('.'))}"><span class="doc-index">${index+1}</span><strong>${escape(cardTitle(item,index,key))}</strong><span class="doc-card-preview">${escape(cardPreview(item))}</span></button>`).join('')}</div>`:'<span class="doc-empty">暂无内容</span>'
  if(typeof value==='object')return `<div class="doc-object ${depth?'nested':''}">${Object.entries(value).map(([childKey,item])=>`<div class="doc-field"><div class="doc-key"><b>${escape(label(childKey))}</b>${labels[childKey]?`<small>${escape(childKey)}</small>`:''}</div><div class="doc-value">${renderValue(item,depth+1,[...path,childKey],childKey)}</div></div>`).join('')}</div>`
  if(typeof value==='boolean')return `<span class="doc-pill ${value?'positive':''}">${value?'是':'否'}</span>`
  if(typeof value==='number')return `<strong class="doc-number">${value}</strong>`
  return `<span class="doc-text">${escape(value)}</span>`
}

const cardTitle=(item,index,key)=>item?.shot_number?`镜头 ${item.shot_number}`:item?.panel_number?`分镜 ${item.panel_number}`:`${label(key||'内容')} ${index+1}`
const cardPreview=item=>typeof item==='object'?item.description||item.name||item.title||item.event||'点击查看详细内容':String(item)

export const renderDocument=value=>`<article class="structured-document">${renderValue(value,0)}</article>`
