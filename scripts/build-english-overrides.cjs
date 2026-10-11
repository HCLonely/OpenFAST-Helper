const fs = require('fs');
const catalog = JSON.parse(fs.readFileSync('data/catalog.json', 'utf8'));
const result = {};
function add(kind, name, description, module = '通用') {
  result[`${kind}:${module}:${name.toLowerCase()}`] = description;
}
const parameters = {
  AFAeroMod: 'Airfoil aerodynamic model: 1=steady, 2=unsteady in common templates. Check the supported options for your version.',
  BDBldFile: 'BeamDyn input file for the corresponding blade; active only when CompElast=2.',
  BlPitch: 'Initial pitch angle of the corresponding blade, deg. Subsequent pitch motion is controlled by ServoDyn and its actuator settings.',
  BlPitchF: 'Final target pitch angle of the corresponding blade pitch maneuver, deg.',
  'BldEdDmp(1)': 'Structural damping for the first blade edgewise mode, usually percent of critical damping.',
  'BldFlDmp(1)': 'Structural damping for the first blade flapwise mode, usually percent of critical damping; check the input units.',
  'BldFlDmp(2)': 'Structural damping for the second blade flapwise mode, usually percent of critical damping.',
  OutList: 'Start of the output-channel list. Following lines request recorded variables until END; requesting an output does not enable its physical model.',
  PC_KI: 'ROSCO pitch PI integral-gain array at the gain-scheduling pitch-angle nodes.',
  PC_KP: 'ROSCO pitch PI proportional-gain array at the gain-scheduling pitch-angle nodes. Units follow the controller interface.',
  PitManRat: 'Pitch maneuver rate for the corresponding blade, deg/s; used with TPitManS and BlPitchF.',
  PreCone: 'Precone angle of the corresponding blade, deg. Preserve the sign required by the ElastoDyn coordinate convention.',
  TPitManS: 'Start time of the corresponding blade pitch maneuver, s; the maneuver overrides normal pitch control.',
  TipMass: 'Concentrated tip-brake mass for the corresponding blade, kg.',
  WakeMod: 'Legacy wake/induction model selector. Interpret supported choices using the input comments and version documentation.',
  KinVisc: 'Kinematic viscosity of the working fluid, m²/s; used to determine quantities such as the Reynolds number in aerodynamic calculations.',
};
for (const [name, description] of Object.entries(parameters)) add('parameter', name, description);
for (const [name, description] of Object.entries({
  ModCoupling: 'Module coupling method from 5.0: 1=loose, 2=tight with fixed Jacobian updates, 3=tight with automatic Jacobian updates.',
  RhoInf: 'Numerical damping parameter of the tight-coupling generalized-alpha integrator, from 0 to 1.',
  ConvTol: 'Convergence tolerance of the tight-coupling generalized-alpha integrator.',
  MaxConvIter: 'Maximum number of convergence iterations in the tight-coupling solver.',
  NRotors: 'Number of rotors. Version 5.0 introduces multiple rotors within one turbine.',
  CompSoil: 'Soil-structure module: 0=disabled, 1=SoilDyn.',
  MirrorRotor: 'Reverse the rotation direction of this rotor. The first rotor keeps the conventional direction.',
  SoilFile: 'SoilDyn soil-structure input file.',
})) add('parameter', name, description, 'OpenFAST');
add('parameter', 'WvCrntMod', 'Combined wave-current model: 0=simple superposition, 1=include Doppler effect, 2=also scale wave amplitude/spectrum.', 'SeaState');
const tables = {
  AttachA: 'Connection-point ID at line end A.', AttachB: 'Connection-point ID at line end B.',
  Attachment: 'Point attachment: fixed=anchor in global coordinates; vessel=fairlead moving with the platform in platform-reference coordinates.',
  AxCa: 'Axial end added-mass coefficient, dimensionless.', AxCd: 'Axial end drag coefficient, dimensionless.',
  AxCp: 'Axial end dynamic-pressure coefficient, dimensionless.', AxCoefID: 'Axial hydrodynamic coefficient-set ID, referenced by JointAxID.',
  'BA/-zeta': 'Axial internal damping BA, N·s. A negative value specifies the target critical damping ratio by its absolute value.',
  BlAFID: 'Airfoil data-file index for this blade node.', BlChord: 'Local blade chord, m.',
  BlSpn: 'Radial/spanwise position of the aerodynamic blade node, m.', BlTwist: 'Local aerodynamic blade twist, deg.',
  CA: 'Point added-mass coefficient, dimensionless.',
  Ca: 'Transverse or point added-mass coefficient, dimensionless; interpret in the current table.',
  CaAx: 'Axial/tangential added-mass coefficient, dimensionless.', Cd: 'Transverse drag coefficient, dimensionless.',
  CdA: 'Point drag coefficient multiplied by its reference area, m².', CdAx: 'Axial/tangential drag coefficient, dimensionless.',
  Diam: 'Equivalent-volume diameter, m; used for displaced volume and hydrodynamic area.',
  Dpth: 'Depth in the depth-dependent coefficient table, m. Increasing depth corresponds to decreasing global Z.',
  EA: 'Axial tensile stiffness E·A, N.', EI: 'Bending stiffness E·I, N·m². The original unit row may show (-).',
  FillDens: 'Internal filling-fluid density, kg/m³; DEFAULT uses WtrDens.',
  FillFSLoc: 'Internal filling-fluid free-surface elevation, m, relative to the MSL2SWL reference.',
  FillMList: 'Member IDs in this filling group.', FillNumM: 'Number of members in this filling group.',
  GenSpd_TLU: 'Generator speed column of the DLL torque lookup table, rpm.', GenTrq_TLU: 'Generator torque column of the DLL lookup table, N·m.',
  ID: 'Connection-point ID, referenced by AttachA/AttachB.', JointAxID: 'Axial end coefficient-set ID for this joint.',
  JointID: 'Hydrodynamic geometry-joint ID, referenced by member endpoints.',
  JointOvrlp: 'Joint overlap handling: 0=none, 1=remove overlap using super-members.',
  Jointxi: 'Joint global X coordinate, m.', Jointyi: 'Joint global Y coordinate, m.', Jointzi: 'Joint global Z coordinate, m, relative to the model sea-level reference.',
  Line: 'Mooring-line ID, used by outputs such as FairTen#/AnchTen#.', LineType: 'Line-property type name, referencing LINE TYPES.',
  M: 'Concentrated point mass, kg.', MCoefMod: 'Hydrodynamic coefficients: 1=uniform/simple, 2=depth-dependent, 3=member-specific.',
  MDivSize: 'Target hydrodynamic discretization segment length of the member, m.',
  MGDens: 'Marine-growth density, kg/m³.', MGDpth: 'Depth/vertical position of a marine-growth entry, m.', MGThck: 'Marine-growth thickness, m.',
  MHstLMod: 'Member hydrostatic-load model: 0=off, 1=analytical, 2=semi-numerical. Rectangular sections support 0/2; avoid duplicate loads when PropPot=True.',
  MJointID1: 'Joint ID at member end 1.', MJointID2: 'Joint ID at member end 2.', MPropSetID: 'Rectangular cross-section property-set ID.',
  MPropSetID1: 'Cross-section property-set ID at member end 1.', MPropSetID2: 'Cross-section property-set ID at member end 2; differing end properties allow taper.',
  MSecGeom: 'Cross-section geometry: 1=circular/cylindrical, 2=rectangular.',
  MSpinOrient: 'Cross-section orientation about the member axis, deg; sets the orientation of rectangular sections.',
  MassDen: 'Mass per unit length, kg/m.', MemberID: 'Hydrodynamic member ID linking endpoints, geometry and member-specific coefficients.',
  MemberID_out: 'Member ID requested for internal output stations.', NOutLoc: 'Number of output locations for this member.',
  Name: 'Mooring-line type name, referenced by LineType in LINES.', NodeLocs: 'Normalized member output positions from end 1 to end 2, between 0 and 1.',
  NumSegs: 'Number of discretized line segments.', Outputs: 'Flags controlling this line’s individual output file.',
  PropA: 'External rectangular-section dimension along A, m.', PropB: 'External rectangular-section dimension along B, m.', PropD: 'External circular-section diameter, m.',
  PropPot: 'True if potential-flow data covers this member. Avoid double counting inertia/hydrostatic contributions; strip theory may still provide viscous drag.',
  PropSetID: 'Circular-section property-set ID.', PropThck: 'Cross-section wall thickness, m.',
  TwrCd: 'Tower aerodynamic drag coefficient, dimensionless.', TwrDiam: 'Diameter at the aerodynamic tower node, m.', TwrElev: 'Aerodynamic tower-node elevation, m.',
  UnstrLen: 'Unstretched line length, m.', V: 'Point displaced volume, m³.',
  X: 'Point X coordinate, m.', Y: 'Point Y coordinate, m.', Z: 'Point Z coordinate, m; positive upwards.',
};
for (const entry of catalog.tables) {
  let description = tables[entry.name];
  const match = /^(Dpth|Member|Simpl)(Ax)?(Ca|Cd|Cp|Cb)([ab])?(MG)?([12])?$/i.exec(entry.name);
  if (match) {
    const [, model, axial, coefficient, direction, growth, end] = match;
    const modelName = { dpth: 'Depth-dependent', member: 'Member-specific', simpl: 'Uniform/simple' }[model.toLowerCase()];
    const physical = { ca: 'added-mass', cd: 'drag', cp: 'dynamic-pressure', cb: 'hydrostatic buoyancy' }[coefficient.toLowerCase()];
    description = `${modelName} ${axial ? 'axial' : 'transverse'} ${physical} coefficient, dimensionless${direction ? ', rectangular '+direction.toUpperCase()+' direction' : ''}; ${growth ? 'with' : 'without'} marine growth${end ? ', member end '+end : ''}.`;
  }
  if (!description) throw Error('Missing table: ' + entry.name);
  add('table', entry.name, description);
}
const outputs = {
  Azimuth: 'Rotor azimuth angle, deg.', GenPwr: 'Generator electrical power, kW.', GenSpeed: 'Generator high-speed shaft speed, rpm.', GenTq: 'Generator torque, kN·m.',
  NacYaw: 'Nacelle yaw angle, deg.', RotSpeed: 'Rotor speed, rpm; useful for checking operating speed and resonance-frequency relationships.',
  RotThrust: 'Rotor axial thrust at the low-speed shaft, kN.', RotTorq: 'Rotor low-speed shaft torque, kN·m.',
  PtfmHeave: 'Platform heave displacement, m.', PtfmSurge: 'Platform surge displacement, m.', PtfmSway: 'Platform sway displacement, m.',
  PtfmPitch: 'Platform pitch angle, deg.', PtfmRoll: 'Platform roll angle, deg.', PtfmYaw: 'Platform yaw angle, deg.',
  TTDspFA: 'Tower-top fore-aft displacement, m.', TTDspSS: 'Tower-top side-to-side displacement, m.',
  YawBrTDxt: 'Yaw-bearing/tower-top fore-aft deflection from the undeflected position along tower xt, m; alias of TTDspFA.',
  YawBrTDyt: 'Yaw-bearing/tower-top side-to-side deflection from the undeflected position along tower yt, m; alias of TTDspSS.',
};
for (const entry of catalog.outputs) {
  const name = entry.name;
  let description = outputs[name], m;
  if (m = /^(AnchTen|FairTen)(\d+)$/.exec(name)) description = `Mooring line ${m[2]}, ${m[1]==='FairTen'?'fairlead':'anchor'}-end tension, N.`;
  if (m = /^BldPitch(\d+)$/.exec(name)) description = `Actual pitch angle of blade ${m[1]}, deg.`;
  if (m = /^(IPDefl|OoPDefl)(\d+)$/.exec(name)) description = `Blade ${m[2]} elastic ${m[1]==='IPDefl'?'in-plane':'out-of-plane'} tip deflection, m.`;
  if (m = /^TwstDefl(\d+)$/.exec(name)) description = `Blade ${m[1]} tip torsional deflection, deg; a nonzero response requires torsion support in the structural model.`;
  if (m = /^Hydro([FM])([xyz])i$/.exec(name)) description = `Resultant platform hydrodynamic ${m[1]==='F'?'force':'moment'} along/about global ${m[2].toUpperCase()}, ${m[1]==='F'?'N':'N·m'}${m[1]==='M'?', about the hydrodynamic reference point':''}.`;
  if (m = /^LSS(Gag|Tip)M([yz])([as])$/.exec(name)) description = `Low-speed shaft ${m[1]==='Gag'?'strain-gauge':'tip'} bending moment about ${m[2]} in the ${m[3]} shaft coordinate system, kN·m.`;
  if (m = /^LSShftF([yz])s$/.exec(name)) description = `Low-speed shaft shear force along ${m[1]} in the s coordinate system, kN.`;
  if (m = /^NcIMUTA([xyz])s$/.exec(name)) description = `Nacelle IMU translational acceleration along ${m[1]} in the s coordinate system, m/s²; check the version’s inertial/gravity convention.`;
  if (m = /^TwHt(\d+)TP([xy])i$/.exec(name)) description = `Total global ${m[2].toUpperCase()} position at tower output station ${m[1]}, m; station numbering follows TwrGagNd.`;
  if (m = /^TwrBs([FM])([xyz])t$/.exec(name)) description = `Tower-base ${m[1]==='F'?'force along':'moment about'} ${m[2]} in the tower t coordinate system, ${m[1]==='F'?'kN':'kN·m'}.`;
  if (m = /^YawBr([FM])([xyz])p$/.exec(name)) description = `Yaw-bearing ${m[1]==='F'?'force along':'moment about'} ${m[2]} in the p coordinate system, ${m[1]==='F'?'kN':'kN·m'}.`;
  if (m = /^Wave(\d+)Elev$/.exec(name)) description = `Incident wave elevation at wave observation point ${m[1]}, m; location is set by WaveElevxi/yi.`;
  if (m = /^Wind(\d+)Vel([XYZ])$/.exec(name)) description = `Global ${m[2]} wind-velocity component at observation point ${m[1]}, m/s; location is set by WindVxiList/yiList/ziList.`;
  if (!description) throw Error('Missing output: ' + name);
  add('output', name, description);
}
fs.writeFileSync('data/catalog-english-overrides.json', JSON.stringify(result, null, 2) + '\n');
