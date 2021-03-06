import React, { Component } from 'react';
import styled from 'styled-components';

import Grid from 'react-virtualized/dist/commonjs/Grid';
import AutoSizer from 'react-virtualized/dist/commonjs/AutoSizer';

import Link from '../Link';
import AppContext from '../Context';
import { getEntities } from '../api';
import { LinkedEntityAvatar, EntityName } from '../Entity';
import { FlatContainer, H4 } from '../Components';
import { niceScroll } from '../cssUtils';
import { Token } from '../ActiveEntityTokens';

const NiceGrid = styled(Grid)`
  ${niceScroll};
`;

const CoverImage = styled.div`
  border-radius: 12px;
  background-image: ${({ src }) => `url(${src})`};
  background-color: ${({ primaryColor }) => primaryColor};
  background-repeat: no-repeat;
  background-position: center;
  background-size: contain;
  width: 200px;
  height: 150px;
`;

const Cover = styled(Link)`
  display: flex;
  flex-direction: column;
  align-items: center;
`;

const Cell = styled.div`
  justify-content: space-evenly;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  align-items: center;
  position: relative;
`;

const Name = styled.span`
  font-family: AvenirNext;
  font-size: 1rem;
  font-weight: 600;
  overflow: hidden;
`;

const Tools = styled.div`
  width: 100%;
`;

const TransferButton = styled(
  class Transfer extends Component {
    render() {
      return <span>Transfer</span>;
    }
  },
)`
  font-family: 'AvenirNext';
  font-weight: 600;
  border: none;
  outline: none;
  color: white;
  background-color: #264dd9;
  font-size: 1rem;
  padding: 0.5em;
  border-radius: 12px;
  cursor: pointer;

  @media (max-width: 770px) {
    padding: 0.1em 0.5rem 0.1em 0.5rem;
  }
`;

export class Avatars extends Component {
  state = {
    entities: [],
  };

  componentDidMount() {
    this.updateEntities(this.props.owner);
  }

  componentWillReceiveProps(nextProps) {
    if (nextProps.owner !== this.props.owner) {
      this.setState({ entities: [] });
      this.updateEntities(nextProps.owner);
    }
  }

  updateEntities = async (owner) => {
    try {
      const entities = await getEntities(owner);
      this.setState({ entities });
    } catch (ex) {}
  };

  render() {
    const { entity, style, title } = this.props;
    const cellSize = 200;
    const columnsNumber = this.state.entities.length;

    return this.state.entities.length ? (
      <AutoSizer>
        {({ width, height }) => (
          <NiceGrid
            cellRenderer={({ ...args }) => this.renderCell(parseInt(width / cellSize), args)}
            columnCount={parseInt(width / cellSize)}
            columnWidth={cellSize}
            height={height}
            rowCount={parseInt(this.state.entities.length / parseInt(width / cellSize)) + 1}
            rowHeight={cellSize}
            width={width}
          />
        )}
      </AutoSizer>
    ) : (
      <span>
        <EntityName id={entity.id} /> doesn't hold any NFTs.
      </span>
    );
  }

  renderCell = (columnCount, { columnIndex, rowIndex, key, style }) => {
    let index = rowIndex * columnCount + columnIndex;
    const entities = this.state.entities.filter((entity) => entity.id !== this.props.entity.id);
    const entity = entities[index];
    if (!entity) return null;
    return (
      <div key={key} style={style}>
        {entity && (
          <Cell>
            <Cover to={`/${entity.id}`}>
              <CoverImage src={entity.image_preview_url} primaryColor={entity.primaryColor} />
              <Name>{entity.name}</Name>
            </Cover>
            <Tools>
              {
                //<TransferButton entity={entity} />
              }
            </Tools>
          </Cell>
        )}
      </div>
    );
  };
}

export default class Nfts extends Component {
  render() {
    const { entity } = this.props;
    return (
      <React.Fragment>
        <AppContext.Consumer>
          {({ entityStore: { entityInfo } }) => {
            if ((!entity.isAddress && entityInfo[entity.id]) || entity.isAddress) {
              const owner = entity.isAddress ? entity.id : entity.owner;
              return (
                <div style={{ width: '100%', height: 'calc(100vh - 190px)' }}>
                  <Avatars entity={entity} owner={owner} />
                </div>
              );
            }
          }}
        </AppContext.Consumer>
      </React.Fragment>
    );
  }
}
