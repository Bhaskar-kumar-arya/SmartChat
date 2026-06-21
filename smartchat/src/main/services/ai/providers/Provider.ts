import { IStreamingProvider } from './IStreamingProvider';
import { IFullResponseProvider } from './IFullResponseProvider';

export interface AIProvider extends IStreamingProvider, IFullResponseProvider {}
