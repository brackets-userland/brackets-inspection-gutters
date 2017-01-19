declare var brackets: any;
declare var define: any;

export type CodeInspectionResultType = 'problem_type_error' | 'problem_type_warning' | 'problem_type_meta';

export interface CodeInspectionPosition {
  line: number;
  ch: number;
}

export interface CodeInspectionResult {
  type: CodeInspectionResultType;
  message: string;
  pos: CodeInspectionPosition;
}

export interface CodeInspectionReport {
  errors: CodeInspectionResult[];
}

export interface GutterOptions {
  error: boolean;
  warning: boolean;
  meta: boolean;
}

define((require, exports, module) => {

  // brackets modules
  const _ = brackets.getModule('thirdparty/lodash');
  const DocumentManager = brackets.getModule('document/DocumentManager');
  const ExtensionUtils = brackets.getModule('utils/ExtensionUtils');
  const MainViewManager = brackets.getModule('view/MainViewManager');
  const EditorManager = brackets.getModule('editor/EditorManager');

  // constants from stylesheet
  const GUTTER_NAME = 'brackets-inspection-gutter';
  const GUTTER_MARKER_NAME = 'brackets-inspection-gutter-marker';
  const GUTTER_WARNING_CLASS = 'brackets-inspection-gutter-warning';
  const GUTTER_ERROR_CLASS = 'brackets-inspection-gutter-error';
  const CM_LINE_NUMBER_GUTTER = 'CodeMirror-linenumbers';

  // to hold stuff in memory
  const markers = {};
  const editorsWithGutters = [];

  function prepareGutter(editor) {
    // add our gutter if its not already available
    const cm = editor._codeMirror;

    const gutters = cm.getOption('gutters').slice(0);
    if (gutters.indexOf(GUTTER_NAME) === -1) {
      // add the gutter just before the linenumbers if possible
      let cmLineNumberIdx = gutters.indexOf(CM_LINE_NUMBER_GUTTER);
      cmLineNumberIdx = cmLineNumberIdx === -1 ? 0 : cmLineNumberIdx;

      gutters.splice(cmLineNumberIdx, 0, GUTTER_NAME);
      cm.setOption('gutters', gutters);
    }

    if (editorsWithGutters.indexOf(editor) === -1) {
      editorsWithGutters.push(editor);
    }
  }

  function removeGutter(editor) {
    const cm = editor._codeMirror;
    if (!cm) { return; }

    const gutters = cm.getOption('gutters').slice(0);
    const io = gutters.indexOf(GUTTER_NAME);
    if (io !== -1) {
      gutters.splice(io, 1);
      cm.clearGutter(GUTTER_NAME);
      cm.setOption('gutters', gutters);
    }

    try {
      const fullPath = editor.document.file.fullPath;
      delete markers[fullPath];
    } catch (err) {
      console.error(`Error clearing data from markers -> ${err}`);
    }
  }

  function prepareGutters(editors) {
    editors.forEach((editor) => prepareGutter(editor));

    // clear the rest
    let idx = editorsWithGutters.length;
    while (idx--) {
      if (editors.indexOf(editorsWithGutters[idx]) === -1) {
        removeGutter(editorsWithGutters[idx]);
        editorsWithGutters.splice(idx, 1);
      }
    }
  }

  function showGutters(editor, fullPath: string) {

    if (markers[fullPath] == null) {
      markers[fullPath] = {};
    }

    let markersForFile: CodeInspectionResult[] = Object.keys(markers[fullPath]).reduce((arr, sourceId) => {
      return arr.concat(markers[fullPath][sourceId]);
    }, []);

    // sortBy severity and then line number
    markersForFile = _.sortBy(markersForFile, (obj) => {
      switch (obj.type) {
        case 'problem_type_error':
          return '1' + _.padLeft(obj.pos.line, 5, '0');
        case 'problem_type_warning':
          return '2' + _.padLeft(obj.pos.line, 5, '0');
        case 'problem_type_meta':
          return '3' + _.padLeft(obj.pos.line, 5, '0');
        default:
          return '4' + _.padLeft(obj.pos.line, 5, '0');
      }
    });

    // make sure we don't put two markers on the same line
    const lines = [];
    markersForFile = markersForFile.filter((obj) => {
      if (lines.indexOf(obj.pos.line) === -1) {
        lines.push(obj.pos.line);
        return true;
      }
      return false;
    });

    const cm = editor._codeMirror;

    cm.clearGutter(GUTTER_NAME);

    markersForFile.forEach((obj: CodeInspectionResult) => {
      const severity = obj.type === 'problem_type_error' ? GUTTER_ERROR_CLASS : GUTTER_WARNING_CLASS;
      const $marker = $('<div><span>')
                        .attr('title', obj.message)
                        .addClass(GUTTER_MARKER_NAME);
      $marker.find('span')
        .addClass(severity)
        .html('&nbsp;');
      const line = _.get(obj, 'pos.line') || 0;
      cm.setGutterMarker(line, GUTTER_NAME, $marker[0]);
    });
  }

  function set(
    sourceId: string, fullPath: string, report: CodeInspectionReport, options: boolean | GutterOptions = true
  ) {

    // filter the report by passed options first
    const errors = report.errors.filter((result: CodeInspectionResult) => {
      if (
        result.type !== 'problem_type_error' &&
        result.type !== 'problem_type_warning' &&
        result.type !== 'problem_type_meta'
      ) {
        console.warn(`${sourceId} -> Unexpected error type: ${result.type}`);
      }
      if (options === true) { return true; }
      if (options === false) { return false; }
      if (result.type === 'problem_type_error' && (options as GutterOptions).error !== true) {
        return false;
      }
      if (result.type === 'problem_type_warning' && (options as GutterOptions).warning !== true) {
        return false;
      }
      if (result.type === 'problem_type_meta' && (options as GutterOptions).meta !== true) {
        return false;
      }
      return true;
    });

    // save the filtered errors to the markers
    markers[fullPath] = markers[fullPath] || {};
    markers[fullPath][sourceId] = errors;

    // get a list of editors, which need to be refreshed
    const editors = _.compact(_.map(MainViewManager.getPaneIdList(), (paneId) => {
      const currentPath = MainViewManager.getCurrentlyViewedPath(paneId);
      const doc = currentPath && DocumentManager.getOpenDocumentForPath(currentPath);
      return doc && doc._masterEditor;
    }));

    // we create empty gutters in all of these editors, all other editors lose their gutters
    prepareGutters(editors);

    const activeEditor = EditorManager.getActiveEditor();
    if (activeEditor && activeEditor.document === DocumentManager.getOpenDocumentForPath(fullPath)) {
      showGutters(activeEditor, fullPath);
    }

  }

  module.exports = () => {
    const w = (window as any);
    if (w.bracketsInspectionGutters) { return; }
    ExtensionUtils.loadStyleSheet(module, '../styles/styles.less');
    w.bracketsInspectionGutters = { set };
  };

});
