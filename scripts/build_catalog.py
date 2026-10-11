"""Build an offline general-purpose catalog; does not change the case files."""
from pathlib import Path
import json
import re
import runpy

HERE = Path(__file__).resolve().parents[1]
ROOT = HERE.parent
data = runpy.run_path(str(ROOT / 'tmp' / 'annotate_c_u2_q5_f.py'))

def neutral(text):
    result = []
    for sentence in text.split('。'):
        parts = re.split(r'(?:；|，)?(?:当前|本工况|本次|此次)', sentence, maxsplit=1)
        general = parts[0].strip(' ；，')
        if general:
            result.append(general)
    return '。'.join(result) + ('。' if result else '')

descriptions = {k: neutral(v) for k,v in data['D'].items()}
descriptions.update({
    'TMax': '仿真终止时间，单位 s；应大于输出开始时间 TStart。',
    'DT': '仿真或模块时间步长，单位 s；DEFAULT 使用耦合驱动提供的默认值。',
    'TStart': '时序结果开始输出的时间，单位 s；与 TMax 的差值决定输出时段。部分模块模板中的此字段标为 currently unused，应以主文件为准。',
    'DT_Out': '主程序时序结果采样间隔，单位 s；采样频率为其倒数，区别于积分步长 DT。',
    'DT_UJac': '更新耦合求解器 Jacobian 矩阵的时间间隔，单位 s；用于耦合数值求解。',
    'RotSpeed': '风轮初始或固定转速，单位 rpm；GenDOF=True 时为初始转速，False 时转动自由度受约束。',
    'WaveHs': '不规则波有效波高 Hs，单位 m；规则波模式下为规则波高度，适用于 WaveMod=1/2/3。',
    'WaveTp': '谱峰周期 Tp，单位 s；规则波模式下为规则波周期，适用于 WaveMod=1/2；谱峰频率 fp=1/Tp。',
    'WavePkShp': 'JONSWAP 谱峰增强因子 γ，无量纲；仅 WaveMod=2 使用，1 对应 PM 谱，DEFAULT 按程序规则计算。',
    'Linearize': '线性化总开关；True 生成运行点附近的小扰动线性模型，False 关闭。',
    'CompElast': '结构模块选择：1=ElastoDyn，2=ElastoDyn 加叶片 BeamDyn；仅模式 2 使用 BDBldFile。',
    'CompAero': '气动力模块选择：0=关闭，1=AeroDyn v14，2=AeroDyn v15；按所用 OpenFAST 版本确认选项。',
    'FileName_BTS': 'TurbSim 全场二进制 .bts 风场文件路径；仅 WindType=3 使用，相对路径以所属输入文件目录为基准。',
    'PotFile': '势流数据根路径，不带扩展名；关联 .hst/.1/.3 及所选择的二阶 QTF 文件。',
    'DiffQTF': '完整二阶差频平台载荷选择：0=关闭，10/11/12=使用对应 WAMIT 差频文件；例如 11 关联 .11d，与 MnDrift、NewmanApp 互斥。',
    'SumQTF': '完整二阶和频平台载荷选择：0=关闭，10/11/12=使用对应 WAMIT 和频文件；例如 11 关联 .11s，区别于 SeaState 二阶波运动学。',
    'WvDiffQTF': '是否生成二阶差频入射波运动学；区别于 HydroDyn 的二阶差频平台载荷 DiffQTF。',
    'WvSumQTF': '是否生成二阶和频入射波运动学；区别于 HydroDyn 的二阶和频平台载荷 SumQTF。',
    'MSL2SWL': '静水面 SWL 相对平均海平面 MSL 的高程偏移，单位 m，向上为正；使用势流模型时须为 0。',
    'WtrDpth': '以平均海平面为基准的水深，单位 m；应与海况、海底及几何定义一致。',
    'WindVziList': '风速观测点惯性系 Z 坐标列表，单位 m；点数对应 NWindVel，不会修改风场本身的参考高度。',
    'FocalDistanceX': '雷达焦点相对轮毂的 X 向坐标，单位 m；连续/脉冲雷达只使用第一个坐标。',
    'XOffset': 'HAWC 风盒沿 +X 的初始位置偏移，单位 m；仅 WindType=5 使用。',
    'RefLength': '均匀风线性水平/竖直切变的参考长度，单位 m；仅 WindType=2 使用。',
})
for k,axis,unit in [('PtfmSurge','纵荡','m'),('PtfmSway','横荡','m'),('PtfmHeave','垂荡','m'),('PtfmRoll','横摇','°'),('PtfmPitch','纵摇','°'),('PtfmYaw','艏摇','°')]:
    descriptions[k] = f'平台初始或固定{axis}状态，单位 {unit}；对应自由度开启时作为初始条件，关闭时受约束。'

extra = {
 'DTAero':'AeroDyn 气动力计算时间间隔，s；DEFAULT 使用驱动提供的默认值。',
 'Wake_Mod':'尾流/诱导模型：0=无，1=BEMT，3=OLAF；选项随版本变化，结合原文件说明使用。',
 'WakeMod':'尾流/诱导模型选择；旧版本字段，含义与有效选项以原文件及版本文档为准。',
 'BEM_Mod':'BEM 模型选择：1=旧式 NoSweepPitchTwist，2=极坐标模型；同时影响相关输出坐标系。',
 'TwrPotent':'塔架势流对入流的影响：0=无，1=基本势流，2=带 Bak 修正。',
 'TwrShadow':'塔影模型：0=关闭，1=Powles，2=Eames。',
 'TwrAero':'是否计算塔架气动载荷。', 'CavitCheck':'是否进行空化检查；水动力能机组相关模型需核对环境压力。',
 'Buoyancy':'是否包含相关气动/水下构件模型的浮力贡献。', 'NacelleDrag':'是否计算机舱拖曳力。',
 'CompAA':'是否计算气动声学；需相应声学输入文件及兼容尾流模型。',
 'AA_InputFile':'气动声学输入文件路径；CompAA=True 时使用。',
 'Skew_Mod':'斜尾流模型选择：0=关闭，-1=线性化时移除非垂直分量，1=启用；按版本核对。',
 'SkewMomCorr':'是否启用斜尾流动量修正；通常仅 Skew_Mod=1 使用。',
 'SkewRedistr_Mod':'斜尾流诱导速度再分布模型：0=关闭，1=Glauert/Pitt/Peters；DEFAULT 按模块规则。',
 'SkewRedistrFactor':'Pitt/Peters 斜尾流修正因子，无量纲；DEFAULT 使用程序默认值。',
 'TipLoss':'是否启用 Prandtl 叶尖损失修正。', 'HubLoss':'是否启用 Prandtl 轮毂损失修正。',
 'TanInd':'是否计算切向诱导速度。', 'AIDrag':'轴向诱导计算是否包含阻力项。', 'TIDrag':'切向诱导计算是否包含阻力项。',
 'IndToler':'诱导求解收敛容差，无量纲；DEFAULT 使用默认精度。', 'MaxIter':'诱导/迭代求解最大迭代次数，整数。',
 'UA_Mod':'非定常气动模型选择，0 通常为关闭；具体可用模型随 AeroDyn 版本变化，参照原说明。',
 'AFAeroMod':'翼型气动模型选择：1=定常，2=非定常（常见模板）；按版本核对。',
 'NumAFfiles':'翼型气动数据文件数量；后续 AFNames 列表长度应匹配。',
 'AFNames':'翼型数据文件路径列表；顺序对应叶片节点使用的翼型编号。',
 'ADBlFile(1)':'1 号叶片 AeroDyn 几何/气动节点输入文件路径。',
 'ADBlFile(2)':'2 号叶片 AeroDyn 几何/气动节点输入文件路径。',
 'ADBlFile(3)':'3 号叶片 AeroDyn 几何/气动节点输入文件路径。',
 'NumTwrNds':'塔架气动节点数，后续表格定义高度、直径、拖曳系数等。',
 'BldFlDmp(1)':'叶片第一挥舞模态结构阻尼，通常为临界阻尼百分比（%），以原文件单位为准。',
 'BldFlDmp(2)':'叶片第二挥舞模态结构阻尼，通常为临界阻尼百分比（%）。',
 'BldEdDmp(1)':'叶片第一摆振模态结构阻尼，通常为临界阻尼百分比（%）。',
 'TwrFADmp(1)':'塔架第一前后弯曲模态结构阻尼，通常为临界阻尼百分比（%）。',
 'TwrFADmp(2)':'塔架第二前后弯曲模态结构阻尼，通常为临界阻尼百分比（%）。',
 'TwrSSDmp(1)':'塔架第一侧向弯曲模态结构阻尼，通常为临界阻尼百分比（%）。',
 'TwrSSDmp(2)':'塔架第二侧向弯曲模态结构阻尼，通常为临界阻尼百分比（%）。',
 'NBlInpSt':'叶片结构分布属性输入站位数量。', 'NTwInpSt':'塔架结构分布属性输入站位数量。',
 'LoggingLevel':'ROSCO 日志等级：0=不写，1=标准 .dbg，2=附加局部变量 .dbg2，3=附加完整 avrSWAP .dbg3。',
 'F_LPFType':'ROSCO 低通滤波器阶次：1=一阶，2=二阶。',
 'F_NotchType':'ROSCO 陷波对象：0=关闭，1=发电机转速，2=塔顶前后运动，3=两者。',
 'IPC_ControlMode':'ROSCO 独立变桨减载模式：0=关闭，1=1P，2=1P+2P。',
 'VS_ControlMode':'ROSCO 额定以上转矩控制模式：0=恒转矩，1=恒功率，2=TSR PI 跟踪加恒转矩，3=TSR PI 跟踪加恒功率。',
 'PC_ControlMode':'ROSCO 变桨模式：0=固定细桨距，1=主动 PI 变桨。',
 'Y_ControlMode':'ROSCO 偏航控制模式：0=关闭，1=偏航速率控制，2=基于独立变桨的偏航控制。',
 'PC_KP':'ROSCO 变桨 PI 控制器比例增益数组；与增益调度桨距节点对应，量纲以控制器接口为准。',
 'PC_KI':'ROSCO 变桨 PI 控制器积分增益数组；与增益调度桨距节点对应。',
 'PC_GS_angles':'ROSCO 变桨增益调度角度数组，rad；与调度增益数组长度一致。',
 'PC_GS_n':'ROSCO 变桨增益调度节点数量。', 'PC_MaxPit':'ROSCO 最大桨距角，rad。', 'PC_MinPit':'ROSCO 最小桨距角，rad。',
 'PC_MaxRat':'ROSCO 最大正向变桨速率，rad/s。', 'PC_MinRat':'ROSCO 最小负向变桨速率，rad/s。',
 'VS_RtTq':'简化变速控制额定高速轴转矩，N·m；仅 VSContrl=1 使用。',
 'SS_Mode':'ROSCO 设定点平滑开关：0=关闭，1=启用。',
 'WE_Mode':'ROSCO 风速估计模式：0=轮毂风低通，1=浸入与不变估计，2=扩展卡尔曼滤波。',
 'PS_Mode':'ROSCO 桨距饱和策略：0=关闭，1=启用。',
 'SD_Mode':'ROSCO 停机策略：0=关闭，1=变桨至最大角。',
 'Fl_Mode':'ROSCO 浮式机组运动反馈：0=关闭，1=平移速度反馈，2=转动速度反馈。',
 'TD_Mode':'ROSCO 塔架阻尼反馈：0=关闭，1=机舱平移加速度反馈至桨距。',
}
descriptions.update(extra)
params = [{'name':k,'description':v,'module':'通用'} for k,v in sorted(descriptions.items())]
params += [
 {'name':'DT','module':'ElastoDyn','description':'结构动力学积分步长，单位 s；DEFAULT 继承耦合驱动步长。'},
 {'name':'DT','module':'ServoDyn','description':'控制器通信间隔，单位 s；DEFAULT 使用驱动默认值，DLL 调用间隔另由 DLL_DT 设置。'},
 {'name':'Echo','module':'ROSCO','description':'ROSCO 输入回显：0=不回显，1=将控制器参数写入 .echo。'},
 {'name':'VS_RtTq','module':'ROSCO','description':'ROSCO 额定发电机转矩，N·m；用于 ROSCO 转矩控制。'},
]
params += json.loads((HERE/'data'/'version-parameters.json').read_text(encoding='utf-8'))

tables = {k:neutral(v) for k,v in data['TABLE'].items()}
tables['MHstLMod'] = '构件静水载荷模型：0=关闭，1=解析，2=半数值；矩形截面只支持 0/2，PropPot=True 时避免重复计算。'
for file in data['SOURCE'].glob('*.dat'):
    for word in re.findall(r'\b[A-Za-z][A-Za-z0-9_]*\b',file.read_text(encoding='utf-8')):
        meaning = data['coefficient'](word)
        if meaning:
            tables[word] = meaning
tables.update({'BlSpn':'叶片气动节点径向/跨度位置，m。','BlChord':'叶片局部弦长，m。','BlTwist':'叶片局部气动扭角，°。',
               'BlAFID':'叶片节点对应翼型数据文件编号。','TwrElev':'塔架气动节点高度，m。','TwrDiam':'塔架气动节点直径，m。','TwrCd':'塔架气动拖曳系数，无量纲。'})
outputs = {k:neutral(v) for k,v in data['CHANNEL'].items()}
for i in range(1,10):
    for axis in 'XYZ': outputs[f'Wind{i}Vel{axis}'] = f'第 {i} 个风速观测点惯性系 {axis} 分量，m/s；位置由 WindVxiList/yiList/ziList 定义。'
    outputs[f'Wave{i}Elev'] = f'第 {i} 个波面观测点入射波高程，m；位置由 WaveElevxi/yi 定义。'
catalog = {'schemaVersion':1,'parameters':params,'tables':[{'name':k,'description':v} for k,v in sorted(tables.items())],
           'outputs':[{'name':k,'description':v} for k,v in sorted(outputs.items())],
           'sources':{'OpenFAST':'https://openfast.readthedocs.io/en/main/source/user/index.html',
                      'MoorDyn':'https://moordyn.readthedocs.io/en/latest/inputs.html',
                      'ROSCO':'https://rosco.readthedocs.io/en/latest/source/rosco.html'}}
(HERE/'data').mkdir(exist_ok=True)
(HERE/'data'/'catalog.json').write_text(json.dumps(catalog,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(f"Catalog: {len(params)} parameters, {len(tables)} table fields, {len(outputs)} outputs")
