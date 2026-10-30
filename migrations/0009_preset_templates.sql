-- ============================================================================
-- 白标 CMS 行业预设扩展（0009）
-- ============================================================================
-- 设计目标：
--   1. 行业预设不再硬编码在源码中，全部存入 D1，运行时可增删改。
--   2. 内置预设（12 个）首次部署时自动写入（INSERT OR IGNORE，幂等）。
--   3. 自定义预设与内置预设同等地位，支持编辑与删除。
--   4. 内置预设删除后，下次部署会重新写入（n 次冥等）。
--
-- 字段说明：
--   id             TEXT PRIMARY KEY   预设唯一标识（slug 化名称，如 logistics-customs）
--   name           TEXT NOT NULL      预设展示名称（如“物流与货运进出口报关”）
--   is_built_in    INTEGER NOT NULL   是否为内置预设（1=内置，0=自定义）
--   content        TEXT NOT NULL      JSON 字符串，包含行业关键词、目标客户、服务特色、应用场景等
--   created_at     TEXT NOT NULL      创建时间
-- ============================================================================

CREATE TABLE IF NOT EXISTS preset_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  is_built_in INTEGER NOT NULL DEFAULT 0,
  content TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_preset_templates_builtin ON preset_templates(is_built_in);

-- ---------------------------------------------------------------------------
-- 内置行业预设种子数据（幂等，重复执行不覆盖站长已改内容）
-- content 字段与 src/utils/industryPresets.ts 的 IndustryPreset 字段对齐：
--   topic, industry, description, targetCustomers, serviceFeatures,
--   applicationScenarios, cities, primaryServices, primaryKeywords,
--   industryKeywords, newsCategories
-- ---------------------------------------------------------------------------

INSERT OR IGNORE INTO preset_templates (id, name, is_built_in, content) VALUES
('enterprise-service', '企业服务咨询', 1,
 '{"topic":"企业服务与办理指南","industry":"企业服务","description":"面向中小企业提供经营、办理与合规咨询的信息站点。","targetCustomers":"中小企业主、企业管理人员、创业者","serviceFeatures":"经营咨询、资质办理、合规指导、年度申报辅导","applicationScenarios":"企业注册变更、资质申请办理、合规审查、年度申报辅导","cities":"北京,上海,广州,深圳,杭州,成都,重庆","primaryServices":"企业登记咨询,资质办理指导,经营合规咨询,年度申报辅导","primaryKeywords":"企业服务,办理流程,合规咨询,资质办理","industryKeywords":"中小企业,企业登记,经营范围,年度申报,纳税申报,资料核验","newsCategories":"政策解读,业务指南,行业资讯,案例解析"}'),

('home-services', '本地家政与维修', 1,
 '{"topic":"本地上门服务指南","industry":"本地生活服务","description":"提供本地上门服务的项目说明、价格因素与选择建议。","targetCustomers":"住户家庭、物业管理方、写字楼企业","serviceFeatures":"上门服务、价格透明、质保承诺、预约便捷","applicationScenarios":"家电维修、保洁清洗、管道疏通、房屋维护","cities":"北京,上海,广州,深圳,杭州,成都,重庆","primaryServices":"家电维修,保洁清洗,管道疏通,房屋维护","primaryKeywords":"上门服务,本地维修,保洁服务,服务流程","industryKeywords":"预约上门,服务报价,质保期限,售后保障,材料清单","newsCategories":"服务指南,行业资讯,常见问题,注意事项"}'),

('education-training', '职业教育培训', 1,
 '{"topic":"职业培训与考证指南","industry":"职业教育","description":"介绍培训课程、报名流程与学习路径的教育信息站点。","targetCustomers":"在职人员、应届毕业生、职业转型者、企业员工","serviceFeatures":"课程体系完善、考证辅导、企业内训、在线学习","applicationScenarios":"职业技能培训、考证辅导、企业内训、在线课程学习","cities":"北京,上海,广州,深圳,杭州,成都,武汉","primaryServices":"职业技能培训,考证辅导,企业内训,在线课程","primaryKeywords":"职业培训,考证辅导,报名流程,学习路径","industryKeywords":"课程安排,报名条件,考试时间,证书用途,学习周期","newsCategories":"考试资讯,政策动态,课程指南,学习方法"}'),

('health-clinic', '健康体检与医疗咨询', 1,
 '{"topic":"健康体检与就医咨询","industry":"健康服务","description":"提供体检项目说明、就诊流程与健康知识的信息站点。","targetCustomers":"个人用户、企业员工、中老年人群","serviceFeatures":"体检套餐多样、就诊流程清晰、健康知识实用","applicationScenarios":"健康体检、慢病管理咨询、体检套餐说明、就诊指引","cities":"北京,上海,广州,深圳,成都,武汉","primaryServices":"健康体检,慢病管理咨询,体检套餐说明,就诊指引","primaryKeywords":"健康体检,体检套餐,就诊流程,健康管理","industryKeywords":"体检项目,空腹要求,报告解读,随访安排,注意事项","newsCategories":"健康知识,政策解读,服务指南,注意事项"}'),

('construction-decoration', '建筑工程与装饰', 1,
 '{"topic":"工程装饰与施工指南","industry":"建筑装饰","description":"面向业主与企业的装饰施工、工程承包与验收说明站点。","targetCustomers":"住宅业主、企业业主、物业管理公司","serviceFeatures":"装饰施工规范、工程承包透明、验收标准明确","applicationScenarios":"室内装饰施工、工程承包、旧房翻新、验收与售后","cities":"北京,上海,广州,深圳,杭州,成都,重庆,武汉","primaryServices":"室内装饰施工,工程承包,旧房翻新,验收与售后","primaryKeywords":"装饰施工,工程承包,施工流程,验收标准","industryKeywords":"施工工艺,材料清单,工期安排,隐蔽工程,质保期限,预算报价","newsCategories":"行业资讯,施工指南,材料知识,案例解析"}'),

('legal-ip', '法律与知识产权', 1,
 '{"topic":"法律咨询与知识产权服务","industry":"法律服务","description":"提供法律咨询、合同审查与商标专利办理说明的信息站点。","targetCustomers":"企业法务、创业者、知识产权权利人","serviceFeatures":"法律咨询专业、合同审查严谨、商标专利办理规范","applicationScenarios":"法律咨询、合同审查、商标注册、专利申请","cities":"北京,上海,广州,深圳,杭州,成都","primaryServices":"法律咨询,合同审查,商标注册,专利申请","primaryKeywords":"法律咨询,合同审查,商标注册,知识产权","industryKeywords":"诉讼流程,证据材料,审查周期,权利范围,风险提示,合规建议","newsCategories":"法规解读,实务指南,行业资讯,案例分析"}'),

('environment-testing', '环保与检测认证', 1,
 '{"topic":"环保合规与检测认证指南","industry":"环保检测","description":"提供环保手续、检测报告与体系认证说明的信息站点。","targetCustomers":"企业环保负责人、工厂管理人员、认证咨询需求方","serviceFeatures":"环保手续办理规范、检测报告权威、体系认证专业","applicationScenarios":"环保手续办理、环境检测、体系认证咨询、排污许可辅导","cities":"北京,上海,广州,深圳,杭州,成都,重庆","primaryServices":"环保手续办理,环境检测,体系认证咨询,排污许可辅导","primaryKeywords":"环保合规,环境检测,体系认证,排污许可","industryKeywords":"检测项目,采样流程,报告周期,排放标准,整改建议,年审要求","newsCategories":"政策解读,合规指南,行业资讯,常见问题"}'),

('logistics-freight', '物流与货运', 1,
 '{"topic":"物流运输与货运服务指南","industry":"物流运输","description":"提供货运、仓储与跨境物流服务说明的信息站点。","targetCustomers":"电商卖家、生产制造企业、贸易公司","serviceFeatures":"运输时效稳定、计费标准透明、货物保险完善","applicationScenarios":"整车运输、零担货运、仓储配送、跨境物流","cities":"北京,上海,广州,深圳,杭州,成都,重庆,武汉","primaryServices":"整车运输,零担货运,仓储配送,跨境物流","primaryKeywords":"物流运输,货运服务,仓储配送,运输时效","industryKeywords":"运输方式,计费标准,货物保险,报关资料,时效保障,跟踪查询","newsCategories":"行业资讯,运输指南,政策动态,常见问题"}'),

('software-it', '软件与 IT 服务', 1,
 '{"topic":"软件开发与信息化服务","industry":"信息技术","description":"面向企业的软件定制、系统集成与运维服务信息站点。","targetCustomers":"企业信息化负责人、初创公司、传统企业","serviceFeatures":"需求调研详细、开发周期可控、售后运维及时","applicationScenarios":"软件定制开发、系统集成、小程序开发、运维支持","cities":"北京,上海,广州,深圳,杭州,成都,重庆","primaryServices":"软件定制开发,系统集成,小程序开发,运维支持","primaryKeywords":"软件开发,系统集成,定制开发,信息化服务","industryKeywords":"需求调研,开发周期,技术架构,数据安全,验收标准,售后运维","newsCategories":"技术资讯,产品动态,实施指南,案例解析"}'),

('auto-service', '汽车服务与维修', 1,
 '{"topic":"汽车维修与养护指南","industry":"汽车服务","description":"提供汽车维修、保养与年检代办说明的信息站点。","targetCustomers":"私家车主、车队管理方、4S店客户","serviceFeatures":"故障诊断准确、配件来源可靠、保养周期明确","applicationScenarios":"汽车维修、定期保养、年检代办、事故车修复","cities":"北京,上海,广州,深圳,杭州,成都,重庆","primaryServices":"汽车维修,定期保养,年检代办,事故车修复","primaryKeywords":"汽车维修,汽车保养,年检代办,维修流程","industryKeywords":"故障诊断,配件来源,保养周期,维修报价,质保期限,救援服务","newsCategories":"用车知识,行业资讯,养护指南,常见问题"}'),

('food-catering', '餐饮与食品经营', 1,
 '{"topic":"餐饮经营与食品合规指南","industry":"餐饮食品","description":"提供餐饮门店经营、食品许可与供应链说明的信息站点。","targetCustomers":"餐饮店主、食品经营者、供应链从业者","serviceFeatures":"门店筹备辅导、食品许可办理、供应链配送稳定","applicationScenarios":"餐饮门店筹备、食品经营许可、供应链配送、门店运营辅导","cities":"北京,上海,广州,深圳,杭州,成都,重庆","primaryServices":"餐饮门店筹备,食品经营许可,供应链配送,门店运营辅导","primaryKeywords":"餐饮经营,食品许可,门店筹备,供应链","industryKeywords":"经营许可,食品安全,后厨管理,进货查验,卫生标准,门店选址","newsCategories":"行业资讯,合规指南,经营知识,案例解析"}'),

('hr-labor', '人力资源与劳务', 1,
 '{"topic":"人力资源与用工合规指南","industry":"人力资源","description":"提供招聘外包、劳务派遣与用工合规说明的信息站点。","targetCustomers":"企业HR、用人单位、灵活用工企业","serviceFeatures":"招聘外包高效、劳务派遣合规、社保代缴专业","applicationScenarios":"招聘外包、劳务派遣、社保代缴、用工合规咨询","cities":"北京,上海,广州,深圳,杭州,成都,重庆","primaryServices":"招聘外包,劳务派遣,社保代缴,用工合规咨询","primaryKeywords":"人力资源,劳务派遣,招聘外包,用工合规","industryKeywords":"用工风险,劳动合同,社保缴纳,薪酬结构,派遣比例,离职流程","newsCategories":"政策解读,用工指南,行业资讯,常见问题"}')
;

-- ============================================================================
-- 端 数 据
-- ============================================================================
