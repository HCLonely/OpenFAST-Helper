import { t } from './i18n';

/** These are editor samples, never solver templates. Served read-only via a virtual URI. */
export const highlightSamples = {
  OpenFAST: `OpenFAST INPUT FILE
! Editor preview only. Adjust OpenFAST settings and the editor theme to compare styles.
--- SIMULATION ---
True Echo - echo input
60 TMax - duration (s)
1.0D-2 DT - time step (s)
--- MODELS ---
1 CompElast - structural model
0 CompHydro - hydrodynamics disabled
"ElastoDyn.dat" EDFile - input path
"HydroDyn.dat" HydroFile - disabled input
True Linearize - linearization
3 NLinTimes - number of times
10, 20, 30 LinTimes - times (s)
`,
  HydroDyn: `HydroDyn INPUT FILE
! Editor preview only. Move the cursor through table cells and numerical values.
--- POTENTIAL FLOW ---
1 PotMod - potential flow enabled
"../HydroData/body" PotFile - coefficient root
1 ExctnMod - excitation
0 RdtnMod - radiation
--- JOINTS ---
3 NJoints - joint count
JointID Jointxi Jointyi Jointzi JointAxID
(-) (m) (m) (m) (-)
1 0.0 0.0 -2.0D+1 0
2 10.0 0.0 -20.0 0
10 0.0 10.0 -20.0 0
--- OUTPUTS ---
2 NJOutputs - joint output count
1, 10 JOutLst - joint IDs
OutList
"HydroFxi", "HydroFyi"

END
`,
  MoorDyn: `MoorDyn INPUT FILE
! Editor preview only. Compare definition/reference roles and active table cells.
--- LINE TYPES ---
Name Diam MassDen EA BA/-zeta EI Cd Ca CdAx CaAx
main 0.1 10 1.0E+8 0 0 1 1 1 1
--- POINTS ---
ID Attachment X Y Z M V CdA CA
1 Fixed 0 0 -100 0 0 0 0
2 Vessel 0 0 -10 0 0 0 0
10 Fixed 10 0 -100 0 0 0 0
11 Fxied 0 0 -2.0D+1 0 0 0 0 ! Deliberate enum error for theme comparison
--- LINES ---
Line LineType AttachA AttachB UnstrLen NumSegs Outputs
1 main 1 2 100 20 -
2 main 10 2 100 20 -
3 main 99 2 100 20 - ! Deliberate unresolved reference
`,
  ElastoDyn: `ElastoDyn INPUT FILE
! Editor preview only. Numeric signs, exponents, units and output channels follow your theme.
--- INITIAL CONDITIONS ---
True GenDOF - generator degree of freedom
12.1 RotSpeed - initial speed (rpm)
-5.0 ShftTilt - shaft tilt (deg)
DEFAULT DT - use driver time step
8 BldNodes - local node bound
2 NBlGages - gauge count
1, 9 BldGagNd - deliberate out-of-range node
--- OUTPUTS ---
OutList
"PtfmSurge", "PtfmPitch"
"RootMxb1", "TwrBsMyt"

END
`,
  AeroDyn: `AeroDyn INPUT FILE
! Editor preview only. Compare valid/invalid array elements and signed exponents.
4 NumTwrNds - local tower-node bound
3 NTwOuts - tower output count
1; 2, 5 TwOutNd - deliberate out-of-range node
2 NBlOuts - blade output count
1, 2 BlOutNd - external blade-node bounds are unverified here
OutList
"RtAeroFxh"
END
`,
};

export function registerEditorPreview(vscode, context) {
  const scheme = 'openfast-highlight-preview';
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(scheme, {
      provideTextDocumentContent(uri) {
        return (
          highlightSamples[
            uri.path
              .split('/')
              .pop()
              ?.replace(/\.dat$/, '')
          ] || ''
        );
      },
    }),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('openfast.previewHighlighting', async () => {
      const selected = await vscode.window.showQuickPick(
        Object.keys(highlightSamples).map((module) => ({
          label: module,
          description: t('editor.previewSample'),
        })),
        { title: t('editor.previewTitle') },
      );
      if (!selected) return;
      const uri = vscode.Uri.parse(`${scheme}:/${selected.label}.dat`);
      const document = await vscode.workspace.openTextDocument(uri);
      await vscode.languages.setTextDocumentLanguage(document, 'openfast');
      await vscode.window.showTextDocument(document, {
        preview: true,
        viewColumn: vscode.ViewColumn?.One,
      });
      // Native Settings edits live configuration; the read-only sample remains alongside it.
      await vscode.commands.executeCommand('workbench.action.splitEditorRight');
      await vscode.commands.executeCommand(
        'workbench.action.openSettings',
        '@ext:hclonely.openfast-helper',
      );
    }),
  );
}
