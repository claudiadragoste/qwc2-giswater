/**
 * Copyright 2017-2021 Sourcepole AG
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree.
 */

import axios from 'axios';
import React from 'react';
import PropTypes from 'prop-types';
import {connect} from 'react-redux';
import ol from 'openlayers';
import isEmpty from 'lodash.isempty';
import {LayerRole, addMarker, removeMarker, removeLayer, addLayerFeatures} from 'qwc2/actions/layers';
import {changeSelectionState} from 'qwc2/actions/selection';
import ResizeableWindow from 'qwc2/components/ResizeableWindow';
import TaskBar from 'qwc2/components/TaskBar';
import IdentifyUtils from 'qwc2/utils/IdentifyUtils';
import LocaleUtils from 'qwc2/utils/LocaleUtils';
import MapUtils from 'qwc2/utils/MapUtils';
import VectorLayerUtils from 'qwc2/utils/VectorLayerUtils';
import ConfigUtils from 'qwc2/utils/ConfigUtils';
import {panTo} from 'qwc2/actions/map';

import GwInfoQtDesignerForm from '../components/GwInfoQtDesignerForm';

class GwInfo extends React.Component {
    static propTypes = {
        addMarker: PropTypes.func,
        changeSelectionState: PropTypes.func,
        click: PropTypes.object,
        currentIdentifyTool: PropTypes.string,
        currentTask: PropTypes.string,
        initialHeight: PropTypes.number,
        initialWidth: PropTypes.number,
        initialX: PropTypes.number,
        initialY: PropTypes.number,
        initiallyDocked: PropTypes.bool,
        layers: PropTypes.array,
        map: PropTypes.object,
        removeLayer: PropTypes.func,
        removeMarker: PropTypes.func,
        selection: PropTypes.object
    }
    static defaultProps = {
        replaceImageUrls: true,
        initialWidth: 240,
        initialHeight: 320,
        initialX: 0,
        initialY: 0
    }
    state = {
        identifyResult: null,
        prevIdentifyResult: null,
        pendingRequests: false
    }
    componentDidUpdate(prevProps, prevState) {
        if (this.props.currentIdentifyTool !== prevProps.currentIdentifyTool && prevProps.currentIdentifyTool === "GwInfo") {
            this.clearResults();
        }
        if (this.props.currentTask === "GwInfo" || this.props.currentIdentifyTool === "GwInfo") {
            this.identifyPoint(prevProps);
        }
    }
    crsStrToInt = (crs) => {
        const parts = crs.split(':')
        return parseInt(parts.slice(-1))
    }
    dispatchButton = (action) => {
        switch (action.name) {
            case "featureLink":
                this.props.removeLayer("searchselection");
                let pendingRequests = false;

                const request_url = ConfigUtils.getConfigProp("gwInfoServiceUrl")
                if (!isEmpty(request_url)) {
                    const params = {
                        "id": action.params.id,
                        "tableName": action.params.tableName
                    }
                    pendingRequests = true
                    axios.get(request_url + "fromid", {params: params}).then((response) => {
                        const result = response.data
                        this.setState({identifyResult: result, pendingRequests: false});
                        this.highlightResult(result)
                        this.addMarkerToResult(result)
                        this.panToResult(result)
                    }).catch((e) => {
                        console.log(e);
                        this.setState({pendingRequests: false});
                    });
                }
                this.setState({identifyResult: {}, prevIdentifyResult: this.state.identifyResult, pendingRequests: pendingRequests});
                break;
        
            default:
                console.warn(`Action \`${action.name}\` cannot be handled.`)
                break;
        }
    }
    identifyPoint = (prevProps) => {
        const clickPoint = this.queryPoint(prevProps);
        if (clickPoint) {
            // Remove any search selection layer to avoid confusion
            this.props.removeLayer("searchselection");
            let pendingRequests = false;
            const queryableLayers = IdentifyUtils.getQueryLayers(this.props.layers, this.props.map).filter(l => {
                return l.url === "http://qwc2.bgeo.es/ogc/qgisserver" // TODO: Hardcoded
            });

            const request_url = ConfigUtils.getConfigProp("gwInfoServiceUrl")
            if (!isEmpty(queryableLayers) && !isEmpty(request_url)) {
                if (queryableLayers.length > 1) {
                    console.warn("There are multiple giswater queryable layers")
                }
                const layer = queryableLayers[0];
                
                const epsg = this.crsStrToInt(this.props.map.projection)
                const zoomRatio = MapUtils.computeForZoom(this.props.map.scales, this.props.map.zoom)
                const params = {
                    "epsg": epsg,
                    "xcoord": clickPoint[0],
                    "ycoord": clickPoint[1],
                    "zoomRatio": zoomRatio,
                    "layers": layer.queryLayers.join(',')
                }
                
                pendingRequests = true
                axios.get(request_url + "fromcoordinates", {params: params}).then(response => {
                    const result = response.data
                    this.setState({identifyResult: result, prevIdentifyResult: null, pendingRequests: false});
                    this.highlightResult(result)
                }).catch((e) => {
                    console.log(e);
                    this.setState({pendingRequests: false});
                });
            }
            this.props.addMarker('identify', clickPoint, '', this.props.map.projection);
            this.setState({identifyResult: {}, prevIdentifyResult: null, pendingRequests: pendingRequests});
        }
    }
    highlightResult = (result) => {
        if (isEmpty(result)) {
            this.props.removeLayer("identifyslection")
        } else {
            const layer = {
                id: "identifyslection",
                role: LayerRole.SELECTION
            };
            const crs = this.props.map.projection
            const geometry = VectorLayerUtils.wktToGeoJSON(result.feature.geometry, crs, crs)
            const feature = {
                id: result.feature.id,
                geometry: geometry.geometry
            }
            this.props.addLayerFeatures(layer, [feature], true)
        }
    }
    panToResult = (result) => {
        // TODO: Maybe we should zoom to the result as well
        if (!isEmpty(result)) {
            const center = this.getGeometryCenter(result.feature.geometry)
            this.props.panTo(center, this.props.map.projection)
        }
    }
    addMarkerToResult = (result) => {
        if (!isEmpty(result)) {
            const center = this.getGeometryCenter(result.feature.geometry)
            this.props.addMarker('identify', center, '', this.props.map.projection);
        }
    }
    getGeometryCenter = (geom) => {
        const geometry = new ol.format.WKT().readGeometry(geom);
        const type = geometry.getType();
        let center = null;
        switch (type) {
        case "Polygon":
            center = geometry.getInteriorPoint().getCoordinates();
            break;
        case "MultiPolygon":
            center = geometry.getInteriorPoints().getClosestPoint(ol.extent.getCenter(geometry.getExtent()));
            break;
        case "Point":
            center = geometry.getCoordinates();
            break;
        case "MultiPoint":
            center = geometry.getClosestPoint(ol.extent.getCenter(geometry.getExtent()));
            break;
        case "LineString":
            center = geometry.getCoordinateAt(0.5);
            break;
        case "MultiLineString":
            center = geometry.getClosestPoint(ol.extent.getCenter(geometry.getExtent()));
            break;
        case "Circle":
            center = geometry.getCenter();
            break;
        default:
            break;
        }
        return center;
    }
    queryPoint = (prevProps) => {
        if (this.props.click.button !== 0 || this.props.click === prevProps.click || (this.props.click.features || []).find(entry => entry.feature === 'startupposmarker')) {
            return null;
        }
        if (this.props.click.feature === 'searchmarker' && this.props.click.geometry && this.props.click.geomType === 'Point') {
            return null;
            // return this.props.click.geometry;
        }
        return this.props.click.coordinate;
    }
    onToolClose = () => {
        this.props.removeMarker('identify');
        this.props.removeLayer("identifyslection");
        this.props.changeSelectionState({geomType: undefined});
        this.setState({identifyResult: null, pendingRequests: false});
    }
    clearResults = () => {
        this.props.removeMarker('identify');
        this.props.removeLayer("identifyslection");
        this.setState({identifyResult: null, pendingRequests: false});
    }
    showPrevResult = () => {
        const result = this.state.prevIdentifyResult
        this.setState({identifyResult: result, prevIdentifyResult: null})
        this.highlightResult(result)
        this.addMarkerToResult(result)
        this.panToResult(result)
    }
    render() {
        let resultWindow = null;
        if (this.state.pendingRequests === true || this.state.identifyResult !== null) {
            let body = null;
            if (isEmpty(this.state.identifyResult)) {
                if (this.state.pendingRequests === true) {
                    body = (<div className="identify-body" role="body"><span className="identify-body-message">{LocaleUtils.tr("identify.querying")}</span></div>);
                } else {
                    body = (<div className="identify-body" role="body"><span className="identify-body-message">{LocaleUtils.tr("identify.noresults")}</span></div>);
                }
            } else {
                const result = this.state.identifyResult
                const prevResultButton = !isEmpty(this.state.prevIdentifyResult) ? (<button className='button' onClick={this.showPrevResult}>Back</button>) : null
                body = (
                    <div className="identify-body" role="body">
                        {prevResultButton}
                        <GwInfoQtDesignerForm form_xml={result.form_xml} readOnly={true} dispatchButton={this.dispatchButton} />
                    </div>
                )
            }
            resultWindow = (
                <ResizeableWindow icon="info-sign"
                    initialHeight={this.props.initialHeight} initialWidth={this.props.initialWidth}
                    initialX={this.props.initialX} initialY={this.props.initialY} initiallyDocked={this.props.initiallyDocked}
                    key="GwInfoWindow"
                    onClose={this.clearResults} title="Giswater Info"
                >
                    {body}
                </ResizeableWindow>
            );
        }
        return [resultWindow, (
            <TaskBar key="GwInfoTaskBar" onHide={this.onToolClose} task="GwInfo">
                {() => ({
                    body: LocaleUtils.tr("infotool.clickhelpPoint")
                })}
            </TaskBar>
        )];
    }
}

const selector = (state) => ({
    click: state.map.click || {modifiers: {}},
    currentTask: state.task.id,
    currentIdentifyTool: state.identify.tool,
    layers: state.layers.flat,
    map: state.map,
    selection: state.selection
});

export default connect(selector, {
    addLayerFeatures: addLayerFeatures,
    addMarker: addMarker,
    changeSelectionState: changeSelectionState,
    panTo: panTo,
    removeMarker: removeMarker,
    removeLayer: removeLayer
})(GwInfo);
